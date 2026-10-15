import type { Agent, NewEvent, StoredEvent, Transaction } from '@steadily/shared-types';
import {
  deviceTimeZone,
  elapsedPercent,
  isWithin,
  monthPeriod,
  percentOf,
  spendingTotals,
  spentForBudget,
  type TimeZoneInput,
} from '../budget-math';
import type { Budget, Repos } from '../ports';

export const BUDGET_COACH = 'budget-coach';

/** Percent-used thresholds that produce `budget.threshold_crossed`. */
export const BUDGET_THRESHOLDS = [75, 90, 100] as const;
/** Thresholds that also ask the Notifier for a `budget_warning`. */
export const BUDGET_WARNING_THRESHOLDS: readonly number[] = [90, 100];

export interface BudgetCoachDeps {
  transactions: Repos['transactions'];
  budgets: Repos['budgets'];
  /** User's zone for month boundaries; defaults to the device zone. */
  timeZone?: TimeZoneInput;
}

/**
 * Budget Coach (D-015 MVP): threshold warnings for monthly budgets.
 *
 * A threshold t is crossed when this transaction moved spending from below to
 * at-or-above it: `before < t ≤ after`, compared in integer cents as
 * `before × 100 < t × budget ≤ after × 100`. Since each transaction is counted
 * once, this emits at most once per budget, period and threshold without
 * reading earlier events. If one transaction jumps several thresholds, only the
 * highest is reported.
 *
 * Which events count, so the same transaction is never counted twice:
 * - `transaction.reconciled` with outcome 'new': the transaction is final, it
 *   is checked against its category budget and the overall budget.
 * - `transaction.categorized` with source 'user' (a correction): the
 *   transaction moved into a category, so only that category's budget is
 *   checked; the overall total did not change.
 * Other events (first categorization before dedup, duplicates, refunds,
 * transfers) can't push a budget up and are ignored. Transactions outside the
 * current local month don't produce warnings.
 *
 * Safe-to-spend and pace are computed on demand by the UI with `budget-math`.
 */
export function createBudgetCoach(deps: BudgetCoachDeps): Agent {
  return {
    name: BUDGET_COACH,
    subscribes: ['transaction.categorized', 'transaction.reconciled'],
    async handle(event, ctx) {
      const trigger = triggerFor(event);
      if (!trigger) return [];

      const tx = await deps.transactions.get(trigger.transactionId);
      if (!tx || tx.deletedAt !== null) return [];
      if (tx.kind !== 'expense' || tx.linkedTransactionId !== null) return [];
      if (trigger.categoryId !== undefined && trigger.categoryId !== tx.categoryId) return [];

      const now = ctx.now();
      const timeZone = deps.timeZone ?? deviceTimeZone();
      const period = monthPeriod(tx.occurredAt, timeZone);
      if (!isWithin(now, period)) return [];

      const budgets = (await deps.budgets.listActive())
        .filter(
          (b) =>
            b.period === 'monthly' &&
            b.amountMinor > 0 &&
            b.currency === tx.currency &&
            (b.categoryId === tx.categoryId || (trigger.includeOverall && b.categoryId === null)),
        )
        // Category budget before the overall one, then by id: stable output for replays.
        .sort((a, b) => Number(a.categoryId === null) - Number(b.categoryId === null) || cmp(a, b));
      if (budgets.length === 0) return [];

      const rows = withTransaction(
        await deps.transactions.listBetween(period.start, period.end),
        tx,
      );
      const options = { period, currency: tx.currency };
      const after = spendingTotals(rows, options);
      const before = spendingTotals(
        rows.filter((r) => r.id !== tx.id),
        options,
      );

      const out: NewEvent[] = [];
      for (const budget of budgets) {
        const spentBefore = spentForBudget(budget, before);
        const spentAfter = spentForBudget(budget, after);
        const threshold = highestCrossed(spentBefore, spentAfter, budget.amountMinor);
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
              urgency: 'instant',
              budgetId: budget.id,
              transactionId: tx.id,
            },
          });
        }
      }
      return out;
    },
  };
}

interface Trigger {
  transactionId: string;
  includeOverall: boolean;
  /** For corrections: the category the event says the transaction moved to. */
  categoryId?: string;
}

function triggerFor(event: StoredEvent): Trigger | null {
  if (event.type === 'transaction.reconciled') {
    if (event.payload.outcome !== 'new') return null;
    return { transactionId: event.payload.transactionId, includeOverall: true };
  }
  if (event.type === 'transaction.categorized') {
    if (event.payload.source !== 'user') return null;
    return {
      transactionId: event.payload.transactionId,
      includeOverall: false,
      categoryId: event.payload.categoryId,
    };
  }
  return null;
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

/** The repo query compares strings; make sure the transaction itself is present once. */
function withTransaction(rows: readonly Transaction[], tx: Transaction): Transaction[] {
  return [...rows.filter((r) => r.id !== tx.id), tx];
}

function cmp(a: Budget, b: Budget): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
