import type { SubscriptionSummary } from '@/data/types';

import {
  monthlyEquivalent,
  nextDueDate,
  priceChange,
  sortByNextDue,
  subscriptionsMonthlyTotal,
} from '../subscriptions';

const NOW = new Date(2026, 9, 15, 9, 30);

function summary(
  merchantName: string,
  fields: Partial<SubscriptionSummary['subscription']> = {},
  previousAmountMinor: number | null = null,
): SubscriptionSummary {
  return {
    previousAmountMinor,
    subscription: {
      id: merchantName,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      deletedAt: null,
      merchantName,
      cadence: 'monthly',
      amountMinor: 1_000,
      currency: 'USD',
      categoryId: 'subscriptions.general',
      lastChargedAt: new Date(2026, 9, 1, 12).toISOString(),
      nextDueAt: new Date(2026, 10, 1, 12).toISOString(),
      dismissed: false,
      ...fields,
    },
  };
}

describe('subscription helpers', () => {
  it('turns every cadence into a monthly cost', () => {
    expect(monthlyEquivalent({ amountMinor: 1_200, cadence: 'monthly' })).toBe(1_200);
    expect(monthlyEquivalent({ amountMinor: 12_000, cadence: 'yearly' })).toBe(1_000);
    expect(monthlyEquivalent({ amountMinor: 3_000, cadence: 'quarterly' })).toBe(1_000);
    expect(monthlyEquivalent({ amountMinor: 1_200, cadence: 'weekly' })).toBe(5_200);
    expect(
      subscriptionsMonthlyTotal([
        { amountMinor: 1_200, cadence: 'monthly' },
        { amountMinor: 12_000, cadence: 'yearly' },
      ]),
    ).toBe(2_200);
  });

  it('rolls a past due date forward to the next charge', () => {
    const past = summary('Gym', {
      nextDueAt: new Date(2026, 7, 10, 12).toISOString(),
    }).subscription;
    const due = nextDueDate(past, NOW);
    // Aug 10 -> Sep 10 -> Oct 10 (still before today) -> Nov 10.
    expect([due.getMonth(), due.getDate()]).toEqual([10, 10]);
    const upcoming = summary('Gym').subscription;
    expect(nextDueDate(upcoming, NOW).toISOString()).toBe(upcoming.nextDueAt);
  });

  it('describes price changes only while the new price holds', () => {
    expect(priceChange(summary('A', { amountMinor: 1_799 }, 1_549))).toEqual({
      direction: 'up',
      diffMinor: 250,
      previousMinor: 1_549,
    });
    expect(priceChange(summary('B', { amountMinor: 999 }, 1_299))?.direction).toBe('down');
    expect(priceChange(summary('C', {}, null))).toBeNull();
  });

  it('sorts soonest first', () => {
    const later = summary('Later', { nextDueAt: new Date(2026, 10, 20).toISOString() });
    const sooner = summary('Sooner', { nextDueAt: new Date(2026, 9, 20).toISOString() });
    expect(sortByNextDue([later, sooner], NOW).map((s) => s.subscription.id)).toEqual([
      'Sooner',
      'Later',
    ]);
  });
});
