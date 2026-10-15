import type { BuiltInCategoryId } from '@steadily/taxonomy';

/**
 * Synthetic demo data for the Home screen. Not real people, accounts or transactions.
 * Replaced by packages/db queries once the data layer is wired up.
 */

export type FixtureTransaction = {
  id: string;
  merchant: string;
  amountCents: number;
  categoryId: BuiltInCategoryId;
  timeLabel: string;
  badge?: { kind: 'priceUp' | 'review'; label: string };
};

export const homeFixture = {
  /** Fixed "now" so the demo and tests render the same text. */
  today: new Date(2026, 9, 15, 9, 30),
  safeToSpend: {
    amountCents: 128_400,
    untilLabel: 'Oct 31',
    perDayCents: 8_000,
  },
  pace: {
    spentRatio: 0.52,
    monthRatio: 0.48,
  },
  toReviewCount: 3,
  recent: [
    {
      id: 'tx-1',
      merchant: 'Blue Bottle Coffee',
      amountCents: 575,
      categoryId: 'food.coffee',
      timeLabel: '8:42 AM',
    },
    {
      id: 'tx-2',
      merchant: "Trader Joe's",
      amountCents: 6_420,
      categoryId: 'food.groceries',
      timeLabel: 'Yesterday',
    },
    {
      id: 'tx-3',
      merchant: 'Uber',
      amountCents: 1_840,
      categoryId: 'transport.general',
      timeLabel: 'Yesterday',
    },
    {
      id: 'tx-4',
      merchant: 'Netflix',
      amountCents: 1_799,
      categoryId: 'subscriptions.general',
      timeLabel: 'Oct 13',
      badge: { kind: 'priceUp', label: 'Price up $2.50' },
    },
  ] satisfies FixtureTransaction[],
} as const;
