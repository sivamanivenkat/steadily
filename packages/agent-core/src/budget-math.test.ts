import { describe, expect, it } from 'vitest';
import type { Transaction } from '@steadily/shared-types';
import {
  addCadence,
  fromLocal,
  monthPeriod,
  paceFor,
  safeToSpend,
  spendingTotals,
  spentForBudget,
  toLocal,
  upcomingCharges,
  zoneOffsetMinutes,
} from './budget-math';
import type { Subscription } from './ports';

// Synthetic data only.
const NY = 'America/New_York';
const id = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

function tx(n: number, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: id(n),
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    deletedAt: null,
    occurredAt: '2026-10-10T12:00:00.000Z',
    amountMinor: 1000,
    currency: 'USD',
    kind: 'expense',
    merchantRaw: null,
    merchantName: 'Synthetic Merchant',
    categoryId: 'food.coffee',
    categoryConfidence: 0.95,
    categorySource: 'dictionary',
    status: 'confirmed',
    source: 'manual',
    accountLast4: null,
    issuerId: null,
    txnRef: null,
    note: null,
    linkedTransactionId: null,
    ...overrides,
  };
}

function sub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: id(900),
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
    merchantName: 'Synthetic Stream',
    cadence: 'monthly',
    amountMinor: 1599,
    currency: 'USD',
    categoryId: 'subscriptions.general',
    lastChargedAt: '2026-10-03T12:00:00.000Z',
    nextDueAt: '2026-11-03T12:00:00.000Z',
    dismissed: false,
    ...overrides,
  };
}

describe('time zones', () => {
  it('reads offsets for IANA zones across DST and for fixed offsets', () => {
    expect(zoneOffsetMinutes(Date.parse('2026-07-01T00:00:00Z'), NY)).toBe(-240);
    expect(zoneOffsetMinutes(Date.parse('2026-12-01T00:00:00Z'), NY)).toBe(-300);
    expect(zoneOffsetMinutes(0, '+05:30')).toBe(330);
    expect(zoneOffsetMinutes(0, '-0700')).toBe(-420);
    expect(zoneOffsetMinutes(0, 'UTC')).toBe(0);
    expect(zoneOffsetMinutes(0, -300)).toBe(-300);
  });

  it('converts local wall time to instants, including DST gaps and overlaps', () => {
    const at = (day: number, month: number, hour: number, minute = 0) =>
      fromLocal({ year: 2026, month, day, hour, minute }, NY).toISOString();
    expect(at(15, 10, 9)).toBe('2026-10-15T13:00:00.000Z');
    // 2026-03-08 02:30 does not exist in New York: shifted to 03:30 EDT.
    expect(at(8, 3, 2, 30)).toBe('2026-03-08T07:30:00.000Z');
    // 2026-11-01 01:30 happens twice: the earlier (EDT) instant.
    expect(at(1, 11, 1, 30)).toBe('2026-11-01T05:30:00.000Z');
  });

  it('round-trips toLocal', () => {
    expect(toLocal('2026-11-01T03:30:00.000Z', NY)).toEqual({
      year: 2026,
      month: 10,
      day: 31,
      hour: 23,
      minute: 30,
    });
  });

  it('rejects unknown zones', () => {
    expect(() => monthPeriod(new Date(), 'Not/AZone')).toThrow(RangeError);
  });
});

describe('monthPeriod', () => {
  it('uses local midnight on the 1st in the user zone', () => {
    expect(monthPeriod('2026-10-15T12:00:00.000Z', NY)).toEqual({
      key: '2026-10',
      start: '2026-10-01T04:00:00.000Z',
      end: '2026-11-01T04:00:00.000Z',
      days: 31,
    });
  });

  it('puts late-evening local times in the local month, not the UTC month', () => {
    // 23:30 on Oct 31 in New York is already November in UTC.
    expect(monthPeriod('2026-11-01T03:30:00.000Z', NY).key).toBe('2026-10');
    expect(monthPeriod('2026-11-01T03:30:00.000Z', 'UTC').key).toBe('2026-11');
    expect(monthPeriod('2026-11-01T04:00:00.000Z', NY).key).toBe('2026-11');
  });

  it('handles months that contain a DST change', () => {
    const march = monthPeriod('2026-03-15T12:00:00.000Z', NY);
    expect(march.start).toBe('2026-03-01T05:00:00.000Z');
    expect(march.end).toBe('2026-04-01T04:00:00.000Z');
    expect(Date.parse(march.end) - Date.parse(march.start)).toBe((31 * 24 - 1) * 3_600_000);

    const november = monthPeriod('2026-11-15T12:00:00.000Z', NY);
    expect(november.start).toBe('2026-11-01T04:00:00.000Z');
    expect(november.end).toBe('2026-12-01T05:00:00.000Z');
  });

  it('supports fixed offsets and rolls over the year', () => {
    const kolkata = monthPeriod('2026-09-30T19:00:00.000Z', '+05:30');
    expect(kolkata.key).toBe('2026-10');
    expect(kolkata.start).toBe('2026-09-30T18:30:00.000Z');

    const december = monthPeriod('2026-12-31T12:00:00.000Z', -300);
    expect(december.key).toBe('2026-12');
    expect(december.end).toBe('2027-01-01T05:00:00.000Z');
  });

  it('knows leap years', () => {
    expect(monthPeriod('2028-02-10T12:00:00.000Z', 'UTC').days).toBe(29);
    expect(monthPeriod('2027-02-10T12:00:00.000Z', 'UTC').days).toBe(28);
  });
});

describe('spendingTotals', () => {
  const october = monthPeriod('2026-10-15T12:00:00.000Z', NY);

  it('sums expenses per category and excludes income and transfers', () => {
    const totals = spendingTotals([
      tx(1, { amountMinor: 450 }),
      tx(2, { amountMinor: 550 }),
      tx(3, { amountMinor: 8000, categoryId: 'food.groceries' }),
      tx(4, { amountMinor: 500000, kind: 'income', categoryId: 'other.general' }),
      tx(5, { amountMinor: 20000, kind: 'transfer', categoryId: 'other.general' }),
    ]);
    expect(totals.byCategory.get('food.coffee')).toBe(1000);
    expect(totals.byCategory.get('food.groceries')).toBe(8000);
    expect(totals.byCategory.has('other.general')).toBe(false);
    expect(totals.totalMinor).toBe(9000);
  });

  it('subtracts linked refunds from the original category', () => {
    const totals = spendingTotals([
      tx(1, { amountMinor: 5000, categoryId: 'shopping.general' }),
      // Refund row categorized differently: attributed to the original's category.
      tx(2, {
        amountMinor: 2000,
        kind: 'refund',
        categoryId: 'other.general',
        linkedTransactionId: id(1),
      }),
    ]);
    expect(totals.byCategory.get('shopping.general')).toBe(3000);
    expect(totals.byCategory.get('other.general')).toBeUndefined();
    expect(totals.totalMinor).toBe(3000);
  });

  it('uses the refund category when the original is in another period, flooring at zero', () => {
    const totals = spendingTotals(
      [
        tx(1, { amountMinor: 1000, categoryId: 'shopping.general' }),
        tx(2, {
          amountMinor: 4000,
          kind: 'refund',
          categoryId: 'shopping.general',
          linkedTransactionId: id(99),
        }),
        tx(3, { amountMinor: 700 }),
      ],
      { period: october },
    );
    expect(totals.byCategory.get('shopping.general')).toBe(0);
    expect(totals.totalMinor).toBe(700);
  });

  it('ignores unlinked refunds, duplicates, deleted rows, other currencies and other periods', () => {
    const totals = spendingTotals(
      [
        tx(1, { amountMinor: 1000 }),
        tx(2, { amountMinor: 300, kind: 'refund' }),
        tx(3, { amountMinor: 1000, linkedTransactionId: id(1) }),
        tx(4, { amountMinor: 1000, deletedAt: '2026-10-11T00:00:00.000Z' }),
        tx(5, { amountMinor: 1000, currency: 'EUR' }),
        tx(6, { amountMinor: 1000, occurredAt: '2026-10-01T03:59:59.000Z' }),
        tx(7, { amountMinor: 1000, occurredAt: '2026-11-01T04:00:00.000Z' }),
        tx(8, { amountMinor: 1, occurredAt: '2026-10-01T04:00:00.000Z' }),
      ],
      { period: october, currency: 'USD' },
    );
    expect(totals.totalMinor).toBe(1001);
  });

  it('picks the right number for a budget', () => {
    const totals = spendingTotals([
      tx(1, { amountMinor: 300 }),
      tx(2, { amountMinor: 700, categoryId: 'food.dining' }),
    ]);
    expect(spentForBudget({ categoryId: null }, totals)).toBe(1000);
    expect(spentForBudget({ categoryId: 'food.dining' }, totals)).toBe(700);
    expect(spentForBudget({ categoryId: 'travel.general' }, totals)).toBe(0);
  });
});

describe('paceFor', () => {
  // Oct 16 00:00 in New York: 15 of 31 days elapsed (48.39%).
  const now = new Date('2026-10-16T04:00:00.000Z');
  const options = { timeZone: NY };

  it('computes elapsed share of the local month', () => {
    const pace = paceFor({ amountMinor: 10000 }, 4000, now, options);
    expect(pace.percentUsed).toBe(40);
    expect(pace.percentOfPeriodElapsed).toBeCloseTo((15 / 31) * 100, 6);
    expect(pace.status).toBe('on_track');
  });

  it('is a little ahead at 2 or more points over the calendar', () => {
    const elapsed = (15 / 31) * 100;
    // Just under 2 points ahead.
    expect(
      paceFor({ amountMinor: 1_000_000 }, Math.floor((elapsed + 1.99) * 10_000), now, options)
        .status,
    ).toBe('on_track');
    expect(
      paceFor({ amountMinor: 1_000_000 }, Math.ceil((elapsed + 2) * 10_000), now, options).status,
    ).toBe('a_little_ahead');
  });

  it('is over at 100% and keeps counting past it', () => {
    expect(paceFor({ amountMinor: 10000 }, 10000, now, options).status).toBe('over');
    const pace = paceFor({ amountMinor: 10000 }, 12500, now, options);
    expect(pace.percentUsed).toBe(125);
    expect(pace.status).toBe('over');
  });

  it('handles a zero budget and the period edges', () => {
    expect(paceFor({ amountMinor: 0 }, 0, now, options).percentUsed).toBe(0);
    expect(paceFor({ amountMinor: 0 }, 1, now, options).status).toBe('over');
    const start = paceFor({ amountMinor: 100 }, 0, new Date('2026-10-01T04:00:00.000Z'), options);
    expect(start.percentOfPeriodElapsed).toBe(0);
    const period = monthPeriod(now, NY);
    expect(
      paceFor({ amountMinor: 100 }, 0, new Date('2026-12-01T00:00:00.000Z'), { period })
        .percentOfPeriodElapsed,
    ).toBe(100);
  });

  it('measures elapsed time correctly in a DST month', () => {
    // March 2026 in New York is 743 hours; Mar 8 12:00 EDT is 7 × 24 + 11 hours in.
    const pace = paceFor({ amountMinor: 100 }, 0, new Date('2026-03-08T16:00:00.000Z'), options);
    expect(pace.percentOfPeriodElapsed).toBeCloseTo(((7 * 24 + 11) / 743) * 100, 6);
  });
});

describe('addCadence and upcomingCharges', () => {
  it('adds calendar months without drifting past month ends', () => {
    expect(addCadence('2026-01-31T12:00:00.000Z', 'monthly').toISOString()).toBe(
      '2026-02-28T12:00:00.000Z',
    );
    expect(addCadence('2026-01-31T12:00:00.000Z', 'monthly', 2).toISOString()).toBe(
      '2026-03-31T12:00:00.000Z',
    );
    expect(addCadence('2028-02-29T12:00:00.000Z', 'yearly').toISOString()).toBe(
      '2029-02-28T12:00:00.000Z',
    );
    expect(addCadence('2026-11-30T12:00:00.000Z', 'quarterly').toISOString()).toBe(
      '2027-02-28T12:00:00.000Z',
    );
    expect(addCadence('2026-10-01T12:00:00.000Z', 'weekly', 2).toISOString()).toBe(
      '2026-10-15T12:00:00.000Z',
    );
  });

  it('projects repeat charges in the window and skips dismissed ones', () => {
    const charges = upcomingCharges(
      [
        sub({
          id: id(901),
          cadence: 'weekly',
          amountMinor: 500,
          nextDueAt: '2026-10-08T12:00:00.000Z',
        }),
        sub({ id: id(902), nextDueAt: '2026-10-20T12:00:00.000Z' }),
        sub({ id: id(903), dismissed: true, nextDueAt: '2026-10-20T12:00:00.000Z' }),
        sub({ id: id(904), nextDueAt: null }),
        sub({ id: id(905), currency: 'EUR', nextDueAt: '2026-10-20T12:00:00.000Z' }),
      ],
      '2026-10-15T00:00:00.000Z',
      '2026-11-01T04:00:00.000Z',
      'USD',
    );
    expect(charges.map((c) => [c.subscriptionId, c.dueAt])).toEqual([
      [id(901), '2026-10-15T12:00:00.000Z'],
      [id(902), '2026-10-20T12:00:00.000Z'],
      [id(901), '2026-10-22T12:00:00.000Z'],
      [id(901), '2026-10-29T12:00:00.000Z'],
    ]);
  });
});

describe('safeToSpend', () => {
  const now = new Date('2026-10-15T16:00:00.000Z'); // Oct 15, noon in New York

  it('subtracts spending and charges still due this period, spread over days left', () => {
    const result = safeToSpend({
      budgetMinor: 300000,
      spentMinor: 120000,
      upcoming: [
        { amountMinor: 1599, dueAt: '2026-10-20T12:00:00.000Z' },
        { amountMinor: 5000, dueAt: '2026-11-01T03:00:00.000Z' }, // Oct 31, 23:00 local
        { amountMinor: 9999, dueAt: '2026-11-01T04:00:00.000Z' }, // next period
        { amountMinor: 7777, dueAt: '2026-10-10T12:00:00.000Z' }, // already past
      ],
      now,
      timeZone: NY,
    });
    expect(result.amountMinor).toBe(300000 - 120000 - 1599 - 5000);
    expect(result.daysLeft).toBe(17);
    expect(result.perDayMinor).toBe(Math.floor(173401 / 17));
    expect(result.until).toBe('2026-11-01T04:00:00.000Z');
  });

  it('counts local days and never goes negative', () => {
    // 23:00 on Oct 30 in New York, already Oct 31 in UTC.
    const late = new Date('2026-10-31T03:00:00.000Z');
    const result = safeToSpend({
      budgetMinor: 1000,
      spentMinor: 5000,
      upcoming: [],
      now: late,
      timeZone: NY,
    });
    expect(result).toEqual({
      amountMinor: 0,
      perDayMinor: 0,
      until: '2026-11-01T04:00:00.000Z',
      daysLeft: 2,
    });
    expect(
      safeToSpend({ budgetMinor: 1000, spentMinor: 0, upcoming: [], now: late, timeZone: 'UTC' })
        .daysLeft,
    ).toBe(1);
  });
});
