import type {
  Agent,
  AgentContext,
  NewEvent,
  StoredEvent,
  Transaction,
} from '@steadily/shared-types';
import {
  deviceTimeZone,
  elapsedPercent,
  fromLocal,
  isWithin,
  monthPeriod,
  percentOf,
  spendingTotals,
  spentForBudget,
  toLocal,
  type TimeZoneInput,
} from '../budget-math';
import type { Budget, Repos } from '../ports';
import { OVER_BUDGET_PERCENT } from './notifier';

export const BUDGET_COACH = 'budget-coach';

/** Percent-used thresholds that produce `budget.threshold_crossed`. */
export const BUDGET_THRESHOLDS = [75, 90, 100] as const;
/** Thresholds that also ask the Notifier for a `budget_warning`. */
export const BUDGET_WARNING_THRESHOLDS: readonly number[] = [90, 100];

/** When the weekly check-in nudge is due, in the user's local time. */
export interface WeeklyCheckinSchedule {
  /** 0 = Sunday ... 6 = Saturday. */
  dayOfWeek: number;
  /** Local "HH:MM". */
  time: string;
}

export const DEFAULT_WEEKLY_CHECKIN: WeeklyCheckinSchedule = { dayOfWeek: 0, time: '18:00' };
/** A check-in more than this late (app not opened, no background run) is skipped. */
export const DEFAULT_CHECKIN_GRACE_HOURS = 48;

/**
 * Remembers which weekly check-in was last sent, as the local date of its
 * slot ("YYYY-MM-DD"). The app can back this with any small persistent store.
 */
export interface LastCheckinStore {
  get(): Promise<string | null>;
  set(slotDate: string): Promise<void>;
}

export class InMemoryLastCheckinStore implements LastCheckinStore {
  constructor(public value: string | null = null) {}

  async get() {
    return this.value;
  }
  async set(slotDate: string) {
    this.value = slotDate;
  }
}

export interface BudgetCoachDeps {
  transactions: Repos['transactions'];
  budgets: Repos['budgets'];
  /** User's zone for month boundaries and the check-in time; defaults to the device zone. */
  timeZone?: TimeZoneInput;
  /** Weekly check-in slot; null turns the check-in off. Default: Sunday 18:00. */
  weeklyCheckin?: WeeklyCheckinSchedule | null;
  /** Defaults to an in-memory store (one check-in per week per process). */
  lastCheckinStore?: LastCheckinStore;
  checkinGraceHours?: number;
}

/**
 * Budget Coach (D-015 MVP): threshold warnings for monthly budgets and the
 * weekly check-in nudge.
 *
 * A threshold t is crossed when a change moved spending from below to
 * at-or-above it: `before < t ≤ after`, compared in integer cents as
 * `before × 100 < t × budget ≤ after × 100`. If one change jumps several
 * thresholds, only the highest is reported. 90% asks for a summary
 * `budget_warning`, 100% (over budget) for an instant one; both carry `threshold`.
 *
 * Which events count, so the same change is never counted twice:
 * - `transaction.reconciled` with outcome 'new': the transaction is final, it
 *   is checked against its category budget and the overall budget.
 * - `transaction.user_corrected`: the transaction moved from one category to
 *   another, so only the new category's budget is checked (the overall total
 *   did not change). `before` places the transaction in the previous category,
 *   `after` in the new one, so the result doesn't depend on whether the
 *   Categorizer has already written the correction. A correction that a later
 *   change has superseded is ignored. Other transactions moved by "apply to
 *   similar" are not re-checked.
 * Other events (duplicates, refunds, transfers) can't push a budget up and are
 * ignored. Changes outside the current local month don't produce warnings.
 *
 * `tick` emits the weekly check-in once per local week, at or after the
 * configured slot and at most `checkinGraceHours` late.
 *
 * Safe-to-spend and pace are computed on demand by the UI with `budget-math`.
 */
export function createBudgetCoach(deps: BudgetCoachDeps): Agent {
  const timeZone = () => deps.timeZone ?? deviceTimeZone();
  const schedule = deps.weeklyCheckin === undefined ? DEFAULT_WEEKLY_CHECKIN : deps.weeklyCheckin;
  if (schedule) parseSchedule(schedule);
  const lastCheckin = deps.lastCheckinStore ?? new InMemoryLastCheckinStore();
  const graceMs = (deps.checkinGraceHours ?? DEFAULT_CHECKIN_GRACE_HOURS) * 3_600_000;

  async function onReconciled(
    event: StoredEvent<'transaction.reconciled'>,
    ctx: AgentContext,
  ): Promise<NewEvent[]> {
    if (event.payload.outcome !== 'new') return [];
    const tx = await spendingTransaction(event.payload.transactionId);
    if (!tx) return [];
    return evaluate(ctx, tx, {
      includeOverall: true,
      before: (others) => others,
      after: (others) => [...others, tx],
    });
  }

  async function onCorrected(
    event: StoredEvent<'transaction.user_corrected'>,
    ctx: AgentContext,
  ): Promise<NewEvent[]> {
    const { categoryId, previousCategoryId } = event.payload;
    if (categoryId === previousCategoryId) return [];
    const tx = await spendingTransaction(event.payload.transactionId);
    if (!tx) return [];
    // Not yet applied (previous) or applied (new); anything else is a later change.
    if (tx.categoryId !== categoryId && tx.categoryId !== previousCategoryId) return [];
    return evaluate(
      ctx,
      { ...tx, categoryId },
      {
        includeOverall: false,
        before: (others) => [...others, { ...tx, categoryId: previousCategoryId }],
        after: (others) => [...others, { ...tx, categoryId }],
      },
    );
  }

  async function spendingTransaction(id: string): Promise<Transaction | null> {
    const tx = await deps.transactions.get(id);
    if (!tx || tx.deletedAt !== null) return null;
    if (tx.kind !== 'expense' || tx.linkedTransactionId !== null) return null;
    return tx;
  }

  /**
   * Checks the budgets of `tx.categoryId` (and the overall one if asked) for a
   * crossing between the `before` and `after` views of this month's rows.
   */
  async function evaluate(
    ctx: AgentContext,
    tx: Transaction,
    view: {
      includeOverall: boolean;
      before: (others: Transaction[]) => Transaction[];
      after: (others: Transaction[]) => Transaction[];
    },
  ): Promise<NewEvent[]> {
    const now = ctx.now();
    const period = monthPeriod(tx.occurredAt, timeZone());
    if (!isWithin(now, period)) return [];

    const budgets = (await deps.budgets.listActive())
      .filter(
        (b) =>
          b.period === 'monthly' &&
          b.amountMinor > 0 &&
          b.currency === tx.currency &&
          (b.categoryId === tx.categoryId || (view.includeOverall && b.categoryId === null)),
      )
      // Category budget before the overall one, then by id: stable output for replays.
      .sort((a, b) => Number(a.categoryId === null) - Number(b.categoryId === null) || cmp(a, b));
    if (budgets.length === 0) return [];

    // The repo query compares strings; make sure the transaction itself is present once.
    const others = (await deps.transactions.listBetween(period.start, period.end)).filter(
      (r) => r.id !== tx.id,
    );
    const options = { period, currency: tx.currency };
    const before = spendingTotals(view.before(others), options);
    const after = spendingTotals(view.after(others), options);

    const out: NewEvent[] = [];
    for (const budget of budgets) {
      const spentAfter = spentForBudget(budget, after);
      const threshold = highestCrossed(
        spentForBudget(budget, before),
        spentAfter,
        budget.amountMinor,
      );
      if (threshold === null) continue;

      out.push({
        type: 'budget.threshold_crossed',
        payload: {
          budgetId: budget.id,
          categoryId: budget.categoryId,
          percentUsed: round1(percentOf(spentAfter, budget.amountMinor)),
          percentOfPeriodElapsed: round1(elapsedPercent(now, period)),
        },
      });
      if (BUDGET_WARNING_THRESHOLDS.includes(threshold)) {
        out.push({
          type: 'notify.request',
          payload: {
            kind: 'budget_warning',
            urgency: threshold >= OVER_BUDGET_PERCENT ? 'instant' : 'summary',
            budgetId: budget.id,
            transactionId: tx.id,
            threshold,
          },
        });
      }
    }
    return out;
  }

  return {
    name: BUDGET_COACH,
    subscribes: ['transaction.reconciled', 'transaction.user_corrected'],
    async handle(event, ctx) {
      if (event.type === 'transaction.reconciled') return onReconciled(event, ctx);
      if (event.type === 'transaction.user_corrected') return onCorrected(event, ctx);
      return [];
    },
    async tick(ctx) {
      if (!schedule) return [];
      const now = ctx.now();
      const slot = latestCheckinSlot(now, schedule, timeZone());
      if (now.getTime() - slot.at.getTime() > graceMs) return [];
      const last = await lastCheckin.get();
      if (last !== null && last >= slot.date) return [];
      await lastCheckin.set(slot.date);
      return [{ type: 'notify.request', payload: { kind: 'weekly_checkin', urgency: 'instant' } }];
    },
  };
}

/**
 * The most recent check-in slot at or before `now`: its instant and its local
 * date ("YYYY-MM-DD"), which identifies the week.
 */
export function latestCheckinSlot(
  now: Date,
  schedule: WeeklyCheckinSchedule,
  timeZone: TimeZoneInput,
): { at: Date; date: string } {
  const { hour, minute } = parseSchedule(schedule);
  const local = toLocal(now, timeZone);
  const today = Date.UTC(local.year, local.month - 1, local.day);
  const weekday = new Date(today).getUTCDay();
  const daysBack = (weekday - schedule.dayOfWeek + 7) % 7;

  for (const extra of [0, 7]) {
    const day = new Date(today - (daysBack + extra) * 86_400_000);
    const fields = {
      year: day.getUTCFullYear(),
      month: day.getUTCMonth() + 1,
      day: day.getUTCDate(),
      hour,
      minute,
    };
    const at = fromLocal(fields, timeZone);
    if (at.getTime() <= now.getTime()) {
      const date = `${fields.year}-${pad(fields.month)}-${pad(fields.day)}`;
      return { at, date };
    }
  }
  // Unreachable: the slot a week earlier is always in the past.
  throw new Error('No check-in slot found');
}

function parseSchedule(schedule: WeeklyCheckinSchedule): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(schedule.time);
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (!match || hour > 23 || minute > 59) throw new RangeError('Invalid check-in time');
  if (!Number.isInteger(schedule.dayOfWeek) || schedule.dayOfWeek < 0 || schedule.dayOfWeek > 6) {
    throw new RangeError('Invalid check-in day');
  }
  return { hour, minute };
}

/** Highest threshold t with before < t ≤ after (percent of `budgetMinor`), in exact integers. */
export function highestCrossed(
  spentBeforeMinor: number,
  spentAfterMinor: number,
  budgetMinor: number,
): number | null {
  let crossed: number | null = null;
  for (const t of BUDGET_THRESHOLDS) {
    if (spentBeforeMinor * 100 < t * budgetMinor && t * budgetMinor <= spentAfterMinor * 100) {
      crossed = t;
    }
  }
  return crossed;
}

function cmp(a: Budget, b: Budget): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
