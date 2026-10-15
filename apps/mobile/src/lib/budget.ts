import type { CategoryId } from '@steadily/taxonomy';

import type { BudgetWithSpent, Transaction } from '@/data/types';

import { startOfMonth, startOfNextMonth } from './dates';

/**
 * How much a transaction moves spending: expenses add, refunds subtract, income and transfers
 * (including "Not an expense") do not count. Deleted rows count for nothing.
 */
export function spendingDelta(tx: Transaction): number {
  if (tx.deletedAt !== null) return 0;
  if (tx.kind === 'expense') return tx.amountMinor;
  if (tx.kind === 'refund') return -tx.amountMinor;
  return 0;
}

export function totalSpent(transactions: readonly Transaction[]): number {
  return transactions.reduce((sum, tx) => sum + spendingDelta(tx), 0);
}

export function spentByCategory(transactions: readonly Transaction[]): Map<CategoryId, number> {
  const totals = new Map<CategoryId, number>();
  for (const tx of transactions) {
    const delta = spendingDelta(tx);
    if (delta !== 0) totals.set(tx.categoryId, (totals.get(tx.categoryId) ?? 0) + delta);
  }
  return totals;
}

/** Share of the calendar month that has gone by, 0-1. */
export function monthProgress(now: Date): number {
  const start = startOfMonth(now).getTime();
  const end = startOfNextMonth(now).getTime();
  return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
}

/** Days left in the month, counting today. */
export function daysLeftInMonth(now: Date): number {
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return lastDay - now.getDate() + 1;
}

export type SafeToSpend = {
  /** What is left of the budget, never below zero. */
  amountMinor: number;
  /** Even split of what is left over the remaining days, rounded down to whole cents. */
  perDayMinor: number;
  /** How far over budget, or 0. */
  overMinor: number;
  /** Spent as a share of the budget (can exceed 1). */
  spentRatio: number;
};

export function safeToSpend(budgetMinor: number, spentMinor: number, now: Date): SafeToSpend {
  const left = budgetMinor - spentMinor;
  const amountMinor = Math.max(0, left);
  return {
    amountMinor,
    perDayMinor: Math.floor(amountMinor / daysLeftInMonth(now)),
    overMinor: Math.max(0, -left),
    spentRatio: budgetMinor > 0 ? spentMinor / budgetMinor : 0,
  };
}

/** The overall monthly budget row (categoryId null), if the user set one. */
export function overallBudget(rows: readonly BudgetWithSpent[]): BudgetWithSpent | null {
  return rows.find((row) => row.budget.categoryId === null) ?? null;
}

/** Per-category rows in taxonomy order is handled by the caller; this drops the overall row. */
export function categoryBudgets(rows: readonly BudgetWithSpent[]): BudgetWithSpent[] {
  return rows.filter((row) => row.budget.categoryId !== null);
}
