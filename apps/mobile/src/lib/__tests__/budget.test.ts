import type { Budget, BudgetWithSpent, Subscription, Transaction } from '@/data/types';

import {
  busiestCategoryBudgets,
  monthlyTotal,
  monthProgress,
  safeToSpend,
  safeToSpendFor,
  spendingDelta,
  spentRatio,
} from '../budget';

const base: Transaction = {
  id: '00000000-0000-4000-8000-000000000001',
  createdAt: '2026-10-10T12:00:00.000Z',
  updatedAt: '2026-10-10T12:00:00.000Z',
  deletedAt: null,
  occurredAt: '2026-10-10T12:00:00.000Z',
  amountMinor: 1_000,
  currency: 'USD',
  kind: 'expense',
  merchantRaw: null,
  merchantName: 'Test',
  categoryId: 'food.dining',
  categoryConfidence: 1,
  categorySource: 'user',
  status: 'confirmed',
  source: 'manual',
  accountLast4: null,
  issuerId: null,
  txnRef: null,
  note: null,
  linkedTransactionId: null,
};

const budget: Budget = {
  id: '00000000-0000-4000-8000-000000000101',
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
  deletedAt: null,
  categoryId: null,
  period: 'monthly',
  amountMinor: 100_000,
  currency: 'USD',
  rollover: false,
};
const row = (amountMinor: number, spentMinor: number): BudgetWithSpent => ({
  budget: { ...budget, amountMinor },
  spentMinor,
});
const subscription = (nextDueAt: string, amountMinor: number): Subscription => ({
  id: '00000000-0000-4000-8000-000000000201',
  createdAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-09-01T12:00:00.000Z',
  deletedAt: null,
  merchantName: 'Streamly',
  cadence: 'monthly',
  amountMinor,
  currency: 'USD',
  categoryId: 'subscriptions.general',
  lastChargedAt: '2026-09-20T12:00:00.000Z',
  nextDueAt,
  dismissed: false,
});

describe('spending math', () => {
  it('counts expenses and linked refunds only, like the Budget Coach', () => {
    const txs: Transaction[] = [
      base,
      { ...base, kind: 'refund', amountMinor: 300, linkedTransactionId: base.id },
      // Unlinked refunds wait for the Reconciler.
      { ...base, kind: 'refund', amountMinor: 400 },
      { ...base, kind: 'income', amountMinor: 50_000 },
      { ...base, kind: 'transfer', amountMinor: 9_000 },
      { ...base, deletedAt: base.createdAt, amountMinor: 7_000 },
      // A duplicate linked to the row it repeats.
      { ...base, amountMinor: 1_000, linkedTransactionId: base.id },
    ];
    expect(txs.map(spendingDelta)).toEqual([1_000, -300, 0, 0, 0, 0, 0]);
  });

  it('measures the month in local time', () => {
    expect(monthProgress(new Date(2026, 9, 1))).toBe(0);
    expect(monthProgress(new Date(2026, 9, 16, 12))).toBeCloseTo(0.5, 1);
    expect(safeToSpend(row(100_000, 0), [], new Date(2026, 9, 31, 23)).daysLeft).toBe(1);
    expect(safeToSpend(row(100_000, 0), [], new Date(2026, 1, 1)).daysLeft).toBe(28);
  });

  it('splits what is left over the remaining days', () => {
    const now = new Date(2026, 9, 15, 9, 30);
    expect(safeToSpend(row(100_000, 26_240), [], now)).toEqual({
      amountMinor: 73_760,
      perDayMinor: 4_338,
      daysLeft: 17,
      overMinor: 0,
      spentRatio: 0.2624,
    });
    expect(safeToSpend(row(10_000, 12_500), [], now)).toEqual({
      amountMinor: 0,
      perDayMinor: 0,
      daysLeft: 17,
      overMinor: 2_500,
      spentRatio: 1.25,
    });
    // No budget but some spending reads as fully used.
    expect(spentRatio(row(0, 500), now)).toBe(1);
    expect(spentRatio(row(0, 0), now)).toBe(0);
  });

  it('reserves subscription charges still due this month', () => {
    const now = new Date(2026, 9, 15, 9, 30);
    const subs = [
      subscription(new Date(2026, 9, 20, 12).toISOString(), 1_799),
      // Due next month: not reserved.
      subscription(new Date(2026, 10, 2, 12).toISOString(), 999),
    ];
    expect(safeToSpend(row(100_000, 26_240), subs, now)).toMatchObject({
      amountMinor: 73_760 - 1_799,
      perDayMinor: Math.floor((73_760 - 1_799) / 17),
    });
  });
});

describe('monthly total for Home', () => {
  const now = new Date(2026, 9, 15, 9, 30);
  const categoryRow = (
    categoryId: Budget['categoryId'],
    amountMinor: number,
    spentMinor: number,
  ): BudgetWithSpent => ({
    budget: { ...budget, categoryId, amountMinor },
    spentMinor,
  });

  it('uses the overall budget when there is one', () => {
    const overall = row(100_000, 20_000);
    const result = monthlyTotal([overall, categoryRow('food.dining', 20_000, 6_000)]);
    expect(result).toEqual({ basis: 'overall', total: overall, categoryIds: [] });
  });

  it('adds up category budgets when there is no overall budget', () => {
    const result = monthlyTotal([
      categoryRow('food.dining', 20_000, 6_000),
      categoryRow('food.coffee', 5_000, 4_500),
    ]);
    expect(result?.basis).toBe('categories');
    expect(result?.categoryIds).toEqual(['food.dining', 'food.coffee']);
    expect(result?.total.budget).toMatchObject({ categoryId: null, amountMinor: 25_000 });
    expect(result?.total.spentMinor).toBe(10_500);
  });

  it('is null without any budget', () => {
    expect(monthlyTotal([])).toBeNull();
  });

  it('reserves only subscriptions in budgeted categories on the category basis', () => {
    const due = subscription(new Date(2026, 9, 20, 12).toISOString(), 1_799);
    const byCategories = monthlyTotal([categoryRow('food.dining', 20_000, 6_000)])!;
    expect(safeToSpendFor(byCategories, [due], now).amountMinor).toBe(14_000);
    const withSubs = monthlyTotal([
      categoryRow('food.dining', 20_000, 6_000),
      categoryRow('subscriptions.general', 5_000, 0),
    ])!;
    expect(safeToSpendFor(withSubs, [due], now).amountMinor).toBe(19_000 - 1_799);
    const overall = monthlyTotal([row(100_000, 26_240)])!;
    expect(safeToSpendFor(overall, [due], now).amountMinor).toBe(73_760 - 1_799);
  });

  it('ranks category budgets by share used', () => {
    const rows = [
      row(100_000, 99_000),
      categoryRow('food.dining', 20_000, 6_000),
      categoryRow('food.coffee', 5_000, 4_500),
      categoryRow('transport.general', 10_000, 0),
      categoryRow('shopping.general', 10_000, 0),
    ];
    expect(busiestCategoryBudgets(rows, now, 3).map((r) => r.budget.categoryId)).toEqual([
      'food.coffee',
      'food.dining',
      'transport.general',
    ]);
  });
});
