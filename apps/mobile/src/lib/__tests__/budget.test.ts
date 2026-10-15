import type { Transaction } from '@/data/types';

import {
  daysLeftInMonth,
  monthProgress,
  safeToSpend,
  spendingDelta,
  spentByCategory,
  totalSpent,
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

describe('spending math', () => {
  it('counts expenses, subtracts refunds and ignores income, transfers and deleted rows', () => {
    const txs: Transaction[] = [
      base,
      { ...base, kind: 'refund', amountMinor: 300 },
      { ...base, kind: 'income', amountMinor: 50_000 },
      { ...base, kind: 'transfer', amountMinor: 9_000 },
      { ...base, deletedAt: base.createdAt, amountMinor: 7_000 },
      { ...base, categoryId: 'food.coffee', amountMinor: 450 },
    ];
    expect(txs.map(spendingDelta)).toEqual([1_000, -300, 0, 0, 0, 450]);
    expect(totalSpent(txs)).toBe(1_150);
    expect(Object.fromEntries(spentByCategory(txs))).toEqual({
      'food.dining': 700,
      'food.coffee': 450,
    });
  });

  it('measures the month in local time', () => {
    expect(daysLeftInMonth(new Date(2026, 9, 15, 9, 30))).toBe(17);
    expect(daysLeftInMonth(new Date(2026, 9, 31, 23, 0))).toBe(1);
    expect(daysLeftInMonth(new Date(2026, 1, 1))).toBe(28);
    expect(monthProgress(new Date(2026, 9, 1))).toBe(0);
    expect(monthProgress(new Date(2026, 9, 16, 12))).toBeCloseTo(0.5, 1);
  });

  it('splits what is left over the remaining days', () => {
    const now = new Date(2026, 9, 15, 9, 30);
    expect(safeToSpend(100_000, 26_240, now)).toEqual({
      amountMinor: 73_760,
      perDayMinor: 4_338,
      overMinor: 0,
      spentRatio: 0.2624,
    });
    expect(safeToSpend(10_000, 12_500, now)).toEqual({
      amountMinor: 0,
      perDayMinor: 0,
      overMinor: 2_500,
      spentRatio: 1.25,
    });
    expect(safeToSpend(0, 500, now).spentRatio).toBe(0);
  });
});
