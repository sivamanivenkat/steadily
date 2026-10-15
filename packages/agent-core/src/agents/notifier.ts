import type { Agent, EventPayload, Settings } from '@steadily/shared-types';
import { deviceTimeZone, toLocal, type TimeZoneInput } from '../budget-math';
import type { Repos } from '../ports';

export const NOTIFIER = 'notifier';

export type NotifyRequest = EventPayload<'notify.request'>;
export type NotificationKind = NotifyRequest['kind'];

/**
 * What the native side receives: ids only. It reads amounts and merchants from
 * the encrypted DB itself, so nothing sensitive crosses the bridge (D-011).
 */
export interface NotificationRef {
  /** The `notify.request` event id; lets the native side drop re-deliveries. */
  requestId: string;
  kind: NotificationKind;
  transactionId?: string;
  budgetId?: string;
  subscriptionId?: string;
}

/** Port to the OS notification layer (D-012). */
export interface NotificationSink {
  /** Post a notification now. */
  deliver(notification: NotificationRef): Promise<void>;
  /** Add to the next daily summary. */
  queueForSummary(notification: NotificationRef): Promise<void>;
}

/** Test sink that records calls. */
export class InMemoryNotificationSink implements NotificationSink {
  readonly delivered: NotificationRef[] = [];
  readonly queued: NotificationRef[] = [];

  async deliver(notification: NotificationRef) {
    this.delivered.push(notification);
  }
  async queueForSummary(notification: NotificationRef) {
    this.queued.push(notification);
  }
}

export type NotifyDecision = 'deliver' | 'summary' | 'drop';

/**
 * Where each kind goes per notify mode, before urgency, quiet hours and the
 * daily-summary setting are applied (D-012: calm by default, ask when unsure).
 */
const ROUTES: Record<Settings['notifyMode'], Record<NotificationKind, NotifyDecision>> = {
  unsure_only: {
    transaction_needs_review: 'deliver',
    transaction_logged: 'summary',
    budget_warning: 'summary',
    subscription_price_up: 'summary',
    weekly_checkin: 'summary',
    daily_summary: 'deliver',
  },
  every_transaction: {
    transaction_needs_review: 'deliver',
    transaction_logged: 'deliver',
    budget_warning: 'summary',
    subscription_price_up: 'summary',
    weekly_checkin: 'summary',
    daily_summary: 'deliver',
  },
  off: {
    transaction_needs_review: 'summary',
    transaction_logged: 'drop',
    budget_warning: 'drop',
    subscription_price_up: 'drop',
    weekly_checkin: 'drop',
    daily_summary: 'deliver',
  },
};

/**
 * The Notifier's decision table, as a pure function:
 *
 * 1. Route by mode (`ROUTES`): `unsure_only` delivers only needs-review
 *    instantly; `every_transaction` also delivers transaction_logged; `off`
 *    keeps only needs-review, in the summary. Everything else goes to the summary.
 * 2. A 'summary'-urgency request is never delivered instantly.
 * 3. During quiet hours an instant delivery goes to the summary instead.
 * 4. With the daily summary turned off, anything bound for it is dropped
 *    (needs-review items stay in the in-app review queue regardless).
 * The `daily_summary` request itself is delivered when the daily summary is on
 * and it is not quiet hours; otherwise dropped (queued items wait for the next one).
 */
export function decideNotification(
  request: Pick<NotifyRequest, 'kind' | 'urgency'>,
  settings: Pick<Settings, 'notifyMode' | 'dailySummary' | 'quietHours'>,
  localMinuteOfDay: number,
): NotifyDecision {
  const quiet = inQuietHours(localMinuteOfDay, settings.quietHours);
  if (request.kind === 'daily_summary') {
    return settings.dailySummary && !quiet ? 'deliver' : 'drop';
  }
  let decision = ROUTES[settings.notifyMode][request.kind];
  if (decision === 'deliver' && (request.urgency === 'summary' || quiet)) decision = 'summary';
  if (decision === 'summary' && !settings.dailySummary) decision = 'drop';
  return decision;
}

/**
 * Quiet hours are local "HH:MM" times, start inclusive, end exclusive. A range
 * whose start is after its end wraps past midnight (22:00–07:00). Equal start
 * and end means no quiet hours.
 */
export function inQuietHours(minuteOfDay: number, quietHours: Settings['quietHours']): boolean {
  if (!quietHours) return false;
  const start = toMinutes(quietHours.start);
  const end = toMinutes(quietHours.end);
  if (start === end) return false;
  return start < end
    ? minuteOfDay >= start && minuteOfDay < end
    : minuteOfDay >= start || minuteOfDay < end;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export interface NotifierDeps {
  settings: Repos['settings'];
  sink: NotificationSink;
  /** User's zone for quiet hours; defaults to the device zone. */
  timeZone?: TimeZoneInput;
}

/**
 * Notifier (D-012): the only agent that reaches the user. Reads settings on
 * every request, decides deliver / summary / drop and hands ids to the sink.
 * Emits no events. Throttling beyond the mode table is left to the sink.
 */
export function createNotifier(deps: NotifierDeps): Agent {
  return {
    name: NOTIFIER,
    subscribes: ['notify.request'],
    async handle(event, ctx) {
      if (event.type !== 'notify.request') return [];
      const settings = await deps.settings.get();
      const local = toLocal(ctx.now(), deps.timeZone ?? deviceTimeZone());
      const decision = decideNotification(event.payload, settings, local.hour * 60 + local.minute);
      if (decision === 'drop') return [];

      const ref = toRef(event.id, event.payload);
      if (decision === 'deliver') await deps.sink.deliver(ref);
      else await deps.sink.queueForSummary(ref);
      return [];
    },
  };
}

/** Copies ids only, so nothing else on the payload can reach the sink. */
function toRef(requestId: string, payload: NotifyRequest): NotificationRef {
  const ref: NotificationRef = { requestId, kind: payload.kind };
  if (payload.transactionId !== undefined) ref.transactionId = payload.transactionId;
  if (payload.budgetId !== undefined) ref.budgetId = payload.budgetId;
  if (payload.subscriptionId !== undefined) ref.subscriptionId = payload.subscriptionId;
  return ref;
}
