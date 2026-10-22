import { addCadence } from '@steadily/agent-core';

import type { Subscription, SubscriptionSummary } from '@/data/types';

import { startOfDay } from './dates';

type Cadence = Subscription['cadence'];

/** Charges per month for each cadence. */
const PER_MONTH: Record<Cadence, number> = {
  weekly: 52 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
};

export const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Every 3 months',
  yearly: 'Yearly',
};

/** Short suffix after an amount: "$17.99/mo". */
export const CADENCE_SUFFIX: Record<Cadence, string> = {
  weekly: '/wk',
  monthly: '/mo',
  quarterly: '/qtr',
  yearly: '/yr',
};

/** Spoken suffix: "17 dollars and 99 cents a month". */
export const CADENCE_SPOKEN: Record<Cadence, string> = {
  weekly: 'a week',
  monthly: 'a month',
  quarterly: 'every 3 months',
  yearly: 'a year',
};

/** What a subscription costs per month, in cents (a yearly $120 plan is $10). */
export function monthlyEquivalent(sub: Pick<Subscription, 'amountMinor' | 'cadence'>): number {
  return Math.round(sub.amountMinor * PER_MONTH[sub.cadence]);
}

/** Monthly cost of all the subscriptions, in cents. */
export function subscriptionsMonthlyTotal(
  subs: readonly Pick<Subscription, 'amountMinor' | 'cadence'>[],
) {
  return subs.reduce((sum, sub) => sum + monthlyEquivalent(sub), 0);
}

/**
 * The next charge on or after today. A due date already past is rolled forward by the cadence,
 * as safe-to-spend does: the missed charge either happened uncaptured or won't come.
 */
export function nextDueDate(
  sub: Pick<Subscription, 'cadence' | 'lastChargedAt' | 'nextDueAt'>,
  now: Date,
): Date {
  const today = startOfDay(now).getTime();
  let due = sub.nextDueAt ? new Date(sub.nextDueAt) : addCadence(sub.lastChargedAt, sub.cadence);
  for (let i = 0; i < 520 && due.getTime() < today; i++) due = addCadence(due, sub.cadence);
  return due;
}

export type PriceChange = { direction: 'up' | 'down'; diffMinor: number; previousMinor: number };

/** The latest price change, if the current price is the one it announced. */
export function priceChange(summary: SubscriptionSummary): PriceChange | null {
  const previous = summary.previousAmountMinor;
  if (previous === null || previous === summary.subscription.amountMinor) return null;
  const diff = summary.subscription.amountMinor - previous;
  return {
    direction: diff > 0 ? 'up' : 'down',
    diffMinor: Math.abs(diff),
    previousMinor: previous,
  };
}

/** Soonest charge first, then by name. */
export function sortByNextDue(
  summaries: readonly SubscriptionSummary[],
  now: Date,
): SubscriptionSummary[] {
  return [...summaries].sort(
    (a, b) =>
      nextDueDate(a.subscription, now).getTime() - nextDueDate(b.subscription, now).getTime() ||
      a.subscription.merchantName.localeCompare(b.subscription.merchantName),
  );
}
