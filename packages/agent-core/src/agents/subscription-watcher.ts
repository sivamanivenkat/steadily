import type { Agent, NewEvent, Transaction } from '@steadily/shared-types';
import { addCadence, type Cadence } from '../budget-math';
import { randomId, type IdGenerator } from '../event-bus';
import type { Repos, Subscription } from '../ports';

export const SUBSCRIPTION_WATCHER = 'subscription-watcher';

const DAY_MS = 86_400_000;

/** Days between two charges that fit each cadence (inclusive). */
export const CADENCE_WINDOWS: Readonly<Record<Cadence, { minDays: number; maxDays: number }>> = {
  weekly: { minDays: 5, maxDays: 9 },
  monthly: { minDays: 28, maxDays: 33 },
  quarterly: { minDays: 84, maxDays: 98 },
  yearly: { minDays: 355, maxDays: 375 },
};
const CADENCES: readonly Cadence[] = ['weekly', 'monthly', 'quarterly', 'yearly'];

/** Charges in a recurring run may differ from the latest by at most this share. */
export const AMOUNT_TOLERANCE = 0.15;
/** Charges needed to detect a subscription; fewer for the Subscriptions category. */
export const MIN_CHARGES = 3;
export const MIN_CHARGES_SUBSCRIPTION_CATEGORY = 2;
/** A price change must exceed both: more than 1% and more than $0.50. */
export const PRICE_CHANGE_MIN_RATIO = 0.01;
export const PRICE_CHANGE_MIN_MINOR = 50;
/**
 * A charge on an existing subscription that differs by more than this is taken
 * as an unrelated purchase at the same merchant, not a new price.
 */
export const UNRELATED_CHARGE_RATIO = 0.5;
/** Up to this many missed (uncaptured) charges still count as the next one. */
const MAX_PERIODS_BETWEEN = 3;
/** Same-amount charges this close together are treated as one (dup not yet reconciled). */
const DUPLICATE_WINDOW_DAYS = 2;

export interface Charge {
  occurredAt: string;
  amountMinor: number;
}

export interface Detection {
  cadence: Cadence;
  /** Latest charge in the recurring run. */
  lastChargedAt: string;
  amountMinor: number;
  /** Charges in the run. */
  count: number;
}

/**
 * Finds a recurring run ending at the latest charge. Walking back from the
 * latest charge, each earlier charge joins the run while the gap to the next
 * one fits the cadence window and its amount is within 15% of the latest.
 * The first cadence (weekly → yearly) whose run has `minCount` charges wins.
 */
export function detectRecurring(
  charges: readonly Charge[],
  minCount = MIN_CHARGES,
): Detection | null {
  const sorted = collapseDuplicates(
    [...charges].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)),
  );
  const latest = sorted[sorted.length - 1];
  if (!latest || sorted.length < minCount) return null;

  for (const cadence of CADENCES) {
    let count = 1;
    let next = latest;
    for (let i = sorted.length - 2; i >= 0; i--) {
      const charge = sorted[i]!;
      if (!fitsCadence(gapDays(charge.occurredAt, next.occurredAt), cadence, 1)) break;
      if (!withinRatio(charge.amountMinor, latest.amountMinor, AMOUNT_TOLERANCE)) break;
      count++;
      next = charge;
    }
    if (count >= minCount) {
      return { cadence, lastChargedAt: latest.occurredAt, amountMinor: latest.amountMinor, count };
    }
  }
  return null;
}

/** Whether `days` fits `periods` consecutive cadence windows. */
export function fitsCadence(days: number, cadence: Cadence, periods: number): boolean {
  const { minDays, maxDays } = CADENCE_WINDOWS[cadence];
  return days >= minDays * periods && days <= maxDays * periods;
}

/** Price changed: |new − old| > 1% of old and > $0.50. */
export function isPriceChange(previousMinor: number, amountMinor: number): boolean {
  const diff = Math.abs(amountMinor - previousMinor);
  return diff > PRICE_CHANGE_MIN_MINOR && diff > previousMinor * PRICE_CHANGE_MIN_RATIO;
}

export interface SubscriptionWatcherDeps {
  transactions: Repos['transactions'];
  subscriptions: Repos['subscriptions'];
  /** Id source for new subscriptions. */
  newId?: IdGenerator;
}

/**
 * Subscription Watcher (D-015 MVP: recurring charge detection, on device).
 *
 * On each categorized expense with a merchant:
 * - Merchant already has a subscription: if this charge is newer than the last
 *   one and arrives 1–3 cadence periods later with a similar amount (±50%), the
 *   subscription moves forward (amount, last charge, next due). A price change
 *   (see `isPriceChange`) emits `subscription.price_changed` and asks the
 *   Notifier for `subscription_price_up`. A dismissed subscription is left
 *   alone: the user said it isn't one.
 * - Otherwise the merchant's history is checked with `detectRecurring`
 *   (3 charges, or 2 in the Subscriptions category) and a new subscription is
 *   stored with `subscription.detected`.
 *
 * Re-delivery of the same event is harmless: the charge is then no longer newer
 * than the stored one, so nothing changes and nothing is emitted.
 */
export function createSubscriptionWatcher(deps: SubscriptionWatcherDeps): Agent {
  const newId = deps.newId ?? randomId;
  return {
    name: SUBSCRIPTION_WATCHER,
    subscribes: ['transaction.categorized'],
    async handle(event, ctx) {
      if (event.type !== 'transaction.categorized') return [];
      const tx = await deps.transactions.get(event.payload.transactionId);
      if (!tx || !isCharge(tx) || tx.merchantName === null) return [];
      const merchantName = tx.merchantName;
      const nowIso = ctx.now().toISOString();

      const existing = await findExisting(deps.subscriptions, merchantName);
      if (existing) {
        if (existing.dismissed) return [];
        return advance(existing, tx, nowIso, deps.subscriptions);
      }

      const history = (await deps.transactions.listByMerchant(merchantName, 50)).filter(
        (t) => isCharge(t) && t.currency === tx.currency && t.id !== tx.id,
      );
      const minCount =
        tx.categoryId === 'subscriptions.general' ? MIN_CHARGES_SUBSCRIPTION_CATEGORY : MIN_CHARGES;
      const detection = detectRecurring([...history, tx], minCount);
      if (!detection) return [];

      const subscription: Subscription = {
        id: newId(),
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
        merchantName,
        cadence: detection.cadence,
        amountMinor: detection.amountMinor,
        currency: tx.currency,
        categoryId: tx.categoryId,
        lastChargedAt: detection.lastChargedAt,
        nextDueAt: addCadence(detection.lastChargedAt, detection.cadence).toISOString(),
        dismissed: false,
      };
      await deps.subscriptions.upsert(subscription);
      return [
        {
          type: 'subscription.detected',
          payload: {
            subscriptionId: subscription.id,
            merchantName,
            cadence: subscription.cadence,
            amountMinor: subscription.amountMinor,
            currency: subscription.currency,
          },
        },
      ];
    },
  };
}

async function advance(
  sub: Subscription,
  tx: Transaction,
  nowIso: string,
  repo: Repos['subscriptions'],
): Promise<NewEvent[]> {
  if (tx.currency !== sub.currency) return [];
  const days = gapDays(sub.lastChargedAt, tx.occurredAt);
  if (days <= 0) return [];
  let fits = false;
  for (let periods = 1; periods <= MAX_PERIODS_BETWEEN && !fits; periods++) {
    fits = fitsCadence(days, sub.cadence, periods);
  }
  if (!fits || !withinRatio(tx.amountMinor, sub.amountMinor, UNRELATED_CHARGE_RATIO)) return [];

  await repo.upsert({
    ...sub,
    updatedAt: nowIso,
    amountMinor: tx.amountMinor,
    lastChargedAt: tx.occurredAt,
    nextDueAt: addCadence(tx.occurredAt, sub.cadence).toISOString(),
  });
  if (!isPriceChange(sub.amountMinor, tx.amountMinor)) return [];
  return [
    {
      type: 'subscription.price_changed',
      payload: {
        subscriptionId: sub.id,
        merchantName: sub.merchantName,
        previousAmountMinor: sub.amountMinor,
        amountMinor: tx.amountMinor,
        currency: sub.currency,
      },
    },
    {
      type: 'notify.request',
      payload: {
        kind: 'subscription_price_up',
        urgency: 'instant',
        subscriptionId: sub.id,
        transactionId: tx.id,
      },
    },
  ];
}

/** Any subscription for the merchant, active ones before dismissed ones. */
async function findExisting(
  repo: Repos['subscriptions'],
  merchantName: string,
): Promise<Subscription | null> {
  const found: Subscription[] = [];
  for (const cadence of CADENCES) {
    const sub = await repo.findByMerchant(merchantName, cadence);
    if (sub) found.push(sub);
  }
  return found.find((s) => !s.dismissed) ?? found[0] ?? null;
}

/** A spending charge: a live expense that isn't a duplicate of another row. */
function isCharge(t: Transaction): boolean {
  return t.deletedAt === null && t.kind === 'expense' && t.linkedTransactionId === null;
}

function collapseDuplicates(sorted: readonly Charge[]): Charge[] {
  const out: Charge[] = [];
  for (const charge of sorted) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.amountMinor === charge.amountMinor &&
      gapDays(prev.occurredAt, charge.occurredAt) < DUPLICATE_WINDOW_DAYS
    ) {
      continue;
    }
    out.push(charge);
  }
  return out;
}

function gapDays(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / DAY_MS;
}

function withinRatio(amount: number, reference: number, ratio: number): boolean {
  return Math.abs(amount - reference) <= reference * ratio;
}
