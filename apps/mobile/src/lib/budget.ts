/**
 * UI adapters over the agent-core budget math (D-015), so the screens and the Budget Coach agree
 * on every number. Only what agent-core lacks lives here.
 */
import {
  elapsedPercent,
  monthPeriod,
  paceFor,
  safeToSpend as coreSafeToSpend,
  upcomingCharges,
} from '@steadily/agent-core';

import type { BudgetWithSpent, Subscription, Transaction } from '@/data/types';

/**
 * How much one transaction moves spending, matching agent-core `spendingTotals`: expenses add,
 * refunds linked to a purchase subtract, everything else (income, transfers, "Not an expense",
 * unlinked refunds, duplicates linked to a kept row, deleted rows) counts for nothing.
 */
export function spendingDelta(tx: Transaction): number {
  if (tx.deletedAt !== null) return 0;
  if (tx.kind === 'expense' && tx.linkedTransactionId === null) return tx.amountMinor;
  if (tx.kind === 'refund' && tx.linkedTransactionId !== null) return -tx.amountMinor;
  return 0;
}

/** Share of the local calendar month that has gone by, 0-1 (the pace bar marker). */
export function monthProgress(now: Date): number {
  return elapsedPercent(now, monthPeriod(now)) / 100;
}

/** Spent as a share of the budget (can exceed 1), as the pace bar fills it. */
export function spentRatio(row: BudgetWithSpent, now: Date): number {
  return paceFor(row.budget, row.spentMinor, now).percentUsed / 100;
}

export type SafeToSpend = {
  /** Budget minus spending minus subscription charges still due this month, never below 0. */
  amountMinor: number;
  /** Even split over the days left, rounded down to whole cents. */
  perDayMinor: number;
  /** Local days left in the month, counting today. */
  daysLeft: number;
  /** How far spending is over the budget, or 0. */
  overMinor: number;
  /** Spent as a share of the budget (can exceed 1). */
  spentRatio: number;
};

/** Safe-to-spend for the overall budget, reserving subscriptions due before the month ends. */
export function safeToSpend(
  overall: BudgetWithSpent,
  subscriptions: readonly Subscription[],
  now: Date,
): SafeToSpend {
  const { budget, spentMinor } = overall;
  const period = monthPeriod(now);
  const safe = coreSafeToSpend({
    budgetMinor: budget.amountMinor,
    spentMinor,
    upcoming: upcomingCharges(subscriptions, now, period.end, budget.currency),
    now,
  });
  return {
    amountMinor: safe.amountMinor,
    perDayMinor: safe.perDayMinor,
    daysLeft: safe.daysLeft,
    overMinor: Math.max(0, spentMinor - budget.amountMinor),
    spentRatio: spentRatio(overall, now),
  };
}

/** The overall monthly budget row (categoryId null), if the user set one. */
export function overallBudget(rows: readonly BudgetWithSpent[]): BudgetWithSpent | null {
  return rows.find((row) => row.budget.categoryId === null) ?? null;
}

/** Per-category rows (taxonomy order is handled by the data source); drops the overall row. */
export function categoryBudgets(rows: readonly BudgetWithSpent[]): BudgetWithSpent[] {
  return rows.filter((row) => row.budget.categoryId !== null);
}
