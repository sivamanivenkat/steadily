import type { CategoryId } from '@steadily/taxonomy';

import { createSyntheticDataSource } from '../synthetic';
import type { SyntheticSeed } from '../syntheticSeed';
import { computeTrends, trendsWindow } from '../trends';
import type { Transaction } from '../types';

const NOW = new Date(2026, 9, 15, 9, 30);

const seed: SyntheticSeed = {
  budgets: [],
  subscriptions: [],
  transactions: [
    {
      daysAgo: 1,
      at: [9, 0],
      merchant: 'Blue Bottle Coffee',
      amountMinor: 575,
      category: 'food.coffee',
    },
    {
      daysAgo: 2,
      at: [9, 0],
      merchant: "Trader Joe's",
      amountMinor: 6_420,
      category: 'food.groceries',
    },
    {
      daysAgo: 3,
      at: [9, 0],
      merchant: 'Payroll',
      amountMinor: 200_000,
      category: 'other.general',
      kind: 'income',
    },
    { daysAgo: 20, at: [9, 0], merchant: 'Chipotle', amountMinor: 3_000, category: 'food.dining' },
  ],
};
const on = (month: number, day: number) => new Date(2026, month, day, 12).toISOString();

let n = 0;
/** A synthetic transaction (made-up merchants and amounts). */
function tx(
  fields: Partial<Transaction> & { occurredAt: string; amountMinor: number },
): Transaction {
  n += 1;
  return {
    id: `00000000-0000-4000-8900-${String(n).padStart(12, '0')}`,
    createdAt: fields.occurredAt,
    updatedAt: fields.occurredAt,
    deletedAt: null,
    currency: 'USD',
    kind: 'expense',
    merchantRaw: null,
    merchantName: 'Somewhere',
    categoryId: 'other.general' as CategoryId,
    categoryConfidence: 1,
    categorySource: 'dictionary',
    status: 'confirmed',
    source: 'manual',
    accountLast4: null,
    issuerId: null,
    txnRef: null,
    note: null,
    linkedTransactionId: null,
    ...fields,
  };
}

function octoberRows(): Transaction[] {
  const groceries = tx({
    occurredAt: on(9, 3),
    amountMinor: 10_000,
    merchantName: "Trader Joe's",
    categoryId: 'food.groceries',
  });
  const dining = tx({
    occurredAt: on(9, 4),
    amountMinor: 5_000,
    merchantName: 'Chipotle',
    categoryId: 'food.dining',
  });
  const septAmazon = tx({
    occurredAt: on(8, 20),
    amountMinor: 4_000,
    merchantName: 'Amazon',
    categoryId: 'shopping.general',
  });
  return [
    groceries,
    dining,
    tx({
      occurredAt: on(9, 6),
      amountMinor: 2_000,
      merchantName: 'Chipotle',
      categoryId: 'food.dining',
    }),
    // The same purchase seen twice (e.g. alert + manual): linked, counted once.
    tx({
      occurredAt: on(9, 3),
      amountMinor: 10_000,
      merchantName: "Trader Joe's",
      categoryId: 'food.groceries',
      linkedTransactionId: groceries.id,
    }),
    tx({ occurredAt: on(9, 5), amountMinor: 200_000, kind: 'income', merchantName: 'Payroll' }),
    tx({ occurredAt: on(9, 7), amountMinor: 30_000, kind: 'transfer', merchantName: 'Savings' }),
    // A $10 refund on the dining charge.
    tx({
      occurredAt: on(9, 8),
      amountMinor: 1_000,
      kind: 'refund',
      merchantName: 'Chipotle',
      categoryId: 'food.dining',
      linkedTransactionId: dining.id,
    }),
    // Not USD: left out.
    tx({ occurredAt: on(9, 9), amountMinor: 99_900, currency: 'EUR', merchantName: 'Abroad' }),
    // Deleted: left out.
    tx({ occurredAt: on(9, 9), amountMinor: 7_700, deletedAt: on(9, 10) }),
    septAmazon,
    // A refund in October for September's purchase lowers October, floored at 0.
    tx({
      occurredAt: on(9, 10),
      amountMinor: 1_500,
      kind: 'refund',
      merchantName: 'Amazon',
      linkedTransactionId: septAmazon.id,
    }),
    tx({ occurredAt: on(4, 2), amountMinor: 7_000, categoryId: 'travel.general' }),
    // Before the chart (April), but inside the window for matching refunds.
    tx({ occurredAt: on(3, 2), amountMinor: 50_000 }),
  ];
}

describe('computeTrends', () => {
  it('adds up the month like the budgets do', () => {
    const trends = computeTrends(octoberRows(), NOW);

    expect(trends.month).toEqual({
      from: new Date(2026, 9, 1).toISOString(),
      to: new Date(2026, 10, 1).toISOString(),
    });
    // Groceries $100 + dining $50 + $20 - $10 refund. Shopping nets to 0 and drops out.
    expect(trends.totalMinor).toBe(16_000);
    expect(trends.byCategory).toEqual([
      { categoryId: 'food.groceries', amountMinor: 10_000 },
      { categoryId: 'food.dining', amountMinor: 6_000 },
    ]);
    expect(trends.previousTotalMinor).toBe(4_000);
  });

  it('charts six months ending with the selected one, oldest first', () => {
    const trends = computeTrends(octoberRows(), NOW);
    expect(trends.months.map((m) => new Date(m.month.from).getMonth())).toEqual([4, 5, 6, 7, 8, 9]);
    expect(trends.months.map((m) => m.totalMinor)).toEqual([7_000, 0, 0, 0, 4_000, 16_000]);
  });

  it('ranks merchants with refunds subtracted and duplicates counted once', () => {
    const trends = computeTrends(octoberRows(), NOW);
    expect(trends.topMerchants).toEqual([
      { name: "Trader Joe's", amountMinor: 10_000, count: 1 },
      { name: 'Chipotle', amountMinor: 6_000, count: 2 },
    ]);
  });

  it('works for an earlier month', () => {
    const trends = computeTrends(octoberRows(), new Date(2026, 8, 3));
    expect(trends.totalMinor).toBe(4_000);
    expect(trends.previousTotalMinor).toBe(0);
    expect(trends.topMerchants).toEqual([{ name: 'Amazon', amountMinor: 4_000, count: 1 }]);
  });

  it('asks for one extra month before the chart', () => {
    expect(trendsWindow(NOW)).toEqual({
      from: new Date(2026, 3, 1).toISOString(),
      to: new Date(2026, 10, 1).toISOString(),
    });
  });
});

describe('synthetic getTrends', () => {
  it('reads the same numbers from the in-memory rows', async () => {
    const source = createSyntheticDataSource({ now: () => NOW, seed });
    const trends = await source.getTrends(NOW);
    // Groceries $64.20 + coffee $5.75; the income does not count. September: dining $30.
    expect(trends.totalMinor).toBe(6_995);
    expect(trends.previousTotalMinor).toBe(3_000);
    expect(trends.byCategory.map((c) => c.categoryId)).toEqual(['food.groceries', 'food.coffee']);
  });
});
