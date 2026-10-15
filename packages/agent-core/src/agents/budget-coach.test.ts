import { describe, expect, it } from 'vitest';
import {
  parseNewEvent,
  type CategorySource,
  type StoredEvent,
  type Transaction,
} from '@steadily/shared-types';
import type { CategoryId } from '@steadily/taxonomy';
import { createInMemoryRepos, type Budget } from '../ports';
import { createCapturingLogger, createFixedClock, createNoopLlm } from '../testing';
import {
  createBudgetCoach,
  DEFAULT_WEEKLY_CHECKIN,
  highestCrossed,
  InMemoryLastCheckinStore,
  latestCheckinSlot,
} from './budget-coach';

// Synthetic data only.
const NY = 'America/New_York';
const id = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const COFFEE_BUDGET = id(501);
const OVERALL_BUDGET = id(502);

function tx(n: number, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: id(n),
    createdAt: '2026-10-10T12:00:00.000Z',
    updatedAt: '2026-10-10T12:00:00.000Z',
    deletedAt: null,
    occurredAt: '2026-10-10T12:00:00.000Z',
    amountMinor: 1000,
    currency: 'USD',
    kind: 'expense',
    merchantRaw: null,
    merchantName: 'Synthetic Cafe',
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

function budget(budgetId: string, categoryId: CategoryId | null, amountMinor: number): Budget {
  return {
    id: budgetId,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
    categoryId,
    period: 'monthly',
    amountMinor,
    currency: 'USD',
    rollover: false,
  };
}

let eventSeq = 0;
function reconciled(
  transactionId: string,
  outcome: 'new' | 'duplicate' | 'refund_linked' | 'transfer' = 'new',
): StoredEvent {
  return {
    id: id(1000 + ++eventSeq),
    type: 'transaction.reconciled',
    at: '2026-10-15T16:00:00.000Z',
    causationId: null,
    payload: { transactionId, outcome },
  };
}

function categorized(
  transactionId: string,
  categoryId: CategoryId,
  source: CategorySource,
): StoredEvent {
  return {
    id: id(1000 + ++eventSeq),
    type: 'transaction.categorized',
    at: '2026-10-15T16:00:00.000Z',
    causationId: null,
    payload: { transactionId, categoryId, confidence: 1, source, needsReview: false },
  };
}

function userCorrected(
  transactionId: string,
  previousCategoryId: CategoryId,
  categoryId: CategoryId,
): StoredEvent {
  return {
    id: id(1000 + ++eventSeq),
    type: 'transaction.user_corrected',
    at: '2026-10-15T16:00:00.000Z',
    causationId: null,
    payload: { transactionId, previousCategoryId, categoryId, applyToSimilar: false },
  };
}

/** Coffee budget $100, overall $500; existing coffee spending `existingCoffee`. */
async function setup(existingCoffee: number, budgets?: Budget[]) {
  const repos = createInMemoryRepos();
  for (const b of budgets ?? [
    budget(COFFEE_BUDGET, 'food.coffee', 10000),
    budget(OVERALL_BUDGET, null, 50000),
  ]) {
    repos.budgets.rows.set(b.id, b);
  }
  if (existingCoffee > 0) await repos.transactions.insert(tx(1, { amountMinor: existingCoffee }));
  const clock = createFixedClock('2026-10-15T16:00:00.000Z');
  const ctx = { now: clock, llm: createNoopLlm(), log: createCapturingLogger() };
  const agent = createBudgetCoach({
    transactions: repos.transactions,
    budgets: repos.budgets,
    timeZone: NY,
  });
  return { repos, ctx, agent, clock };
}

describe('highestCrossed', () => {
  it('reports the highest threshold with before < t <= after', () => {
    expect(highestCrossed(7400, 7500, 10000)).toBe(75);
    expect(highestCrossed(7500, 8900, 10000)).toBe(null);
    expect(highestCrossed(7500, 9000, 10000)).toBe(90);
    expect(highestCrossed(7000, 10500, 10000)).toBe(100);
    expect(highestCrossed(10000, 12000, 10000)).toBe(null);
    expect(highestCrossed(0, 0, 10000)).toBe(null);
    // Exact integer comparison: 75% of $3.33 is 249.75 cents.
    expect(highestCrossed(249, 250, 333)).toBe(75);
    expect(highestCrossed(250, 260, 333)).toBe(null);
  });
});

describe('Budget Coach', () => {
  it('emits threshold_crossed at 75% without a notification', async () => {
    const { repos, ctx, agent } = await setup(7000);
    await repos.transactions.insert(tx(2, { amountMinor: 1000 }));
    const out = await agent.handle(reconciled(id(2)), ctx);
    expect(out).toEqual([
      {
        type: 'budget.threshold_crossed',
        payload: {
          budgetId: COFFEE_BUDGET,
          categoryId: 'food.coffee',
          percentUsed: 80,
          percentOfPeriodElapsed: 46.8,
        },
      },
    ]);
    for (const event of out) expect(() => parseNewEvent(event)).not.toThrow();
  });

  it('asks for a summary budget_warning at 90%, marked with the threshold', async () => {
    const { repos, ctx, agent } = await setup(8500);
    await repos.transactions.insert(tx(2, { amountMinor: 600 }));
    const out = await agent.handle(reconciled(id(2)), ctx);
    expect(out.map((e) => e.type)).toEqual(['budget.threshold_crossed', 'notify.request']);
    expect(out[1]).toEqual({
      type: 'notify.request',
      payload: {
        kind: 'budget_warning',
        urgency: 'summary',
        budgetId: COFFEE_BUDGET,
        transactionId: id(2),
        threshold: 90,
      },
    });
    for (const event of out) expect(() => parseNewEvent(event)).not.toThrow();
  });

  it('asks for an instant budget_warning at 100%', async () => {
    const { repos, ctx, agent } = await setup(9500);
    await repos.transactions.insert(tx(2, { amountMinor: 500 }));
    const out = await agent.handle(reconciled(id(2)), ctx);
    expect(out[1]).toEqual({
      type: 'notify.request',
      payload: {
        kind: 'budget_warning',
        urgency: 'instant',
        budgetId: COFFEE_BUDGET,
        transactionId: id(2),
        threshold: 100,
      },
    });
    for (const event of out) expect(() => parseNewEvent(event)).not.toThrow();
  });

  it('reports one event for the highest threshold when several are jumped', async () => {
    const { repos, ctx, agent } = await setup(7000);
    await repos.transactions.insert(tx(2, { amountMinor: 3500 }));
    const out = await agent.handle(reconciled(id(2)), ctx);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ payload: { percentUsed: 105 } });
  });

  it('stays silent when no threshold is crossed', async () => {
    const { repos, ctx, agent } = await setup(7600);
    await repos.transactions.insert(tx(2, { amountMinor: 1000 }));
    expect(await agent.handle(reconciled(id(2)), ctx)).toEqual([]);
  });

  it('checks the overall budget too, ordered after the category budget', async () => {
    const { repos, ctx, agent } = await setup(0, [
      budget(COFFEE_BUDGET, 'food.coffee', 10000),
      budget(OVERALL_BUDGET, null, 50000),
    ]);
    await repos.transactions.insert(
      tx(3, {
        amountMinor: 36000,
        categoryId: 'food.groceries',
        occurredAt: '2026-10-02T12:00:00.000Z',
      }),
    );
    await repos.transactions.insert(tx(2, { amountMinor: 9000 }));
    const out = await agent.handle(reconciled(id(2)), ctx);
    expect(out.map((e) => [e.type, 'budgetId' in e.payload ? e.payload.budgetId : null])).toEqual([
      ['budget.threshold_crossed', COFFEE_BUDGET],
      ['notify.request', COFFEE_BUDGET],
      ['budget.threshold_crossed', OVERALL_BUDGET],
      ['notify.request', OVERALL_BUDGET],
    ]);
  });

  it('ignores duplicates, refunds, transfers and non-final categorizations', async () => {
    const { repos, ctx, agent } = await setup(7000);
    await repos.transactions.insert(tx(2, { amountMinor: 3000 }));
    expect(await agent.handle(reconciled(id(2), 'duplicate'), ctx)).toEqual([]);
    expect(await agent.handle(reconciled(id(2), 'refund_linked'), ctx)).toEqual([]);
    expect(await agent.handle(reconciled(id(2), 'transfer'), ctx)).toEqual([]);
    expect(await agent.handle(categorized(id(2), 'food.coffee', 'dictionary'), ctx)).toEqual([]);

    await repos.transactions.insert(tx(3, { amountMinor: 3000, kind: 'transfer' }));
    expect(await agent.handle(reconciled(id(3)), ctx)).toEqual([]);
    await repos.transactions.insert(tx(4, { amountMinor: 3000, linkedTransactionId: id(1) }));
    expect(await agent.handle(reconciled(id(4)), ctx)).toEqual([]);
    expect(await agent.handle(reconciled(id(404)), ctx)).toEqual([]);
  });

  describe('user corrections', () => {
    it('checks only the new category budget after a correction', async () => {
      const { repos, ctx, agent } = await setup(7000);
      // $40 moved from Dining into Coffee: coffee goes 70% -> 110%, overall unchanged.
      await repos.transactions.insert(
        tx(2, { amountMinor: 4000, categoryId: 'food.coffee', categorySource: 'user' }),
      );
      const out = await agent.handle(userCorrected(id(2), 'food.dining', 'food.coffee'), ctx);
      expect(out.map((e) => e.type)).toEqual(['budget.threshold_crossed', 'notify.request']);
      expect(out[0]).toMatchObject({ payload: { budgetId: COFFEE_BUDGET, percentUsed: 110 } });
      expect(out[1]).toMatchObject({ payload: { urgency: 'instant', threshold: 100 } });
      for (const event of out) expect(() => parseNewEvent(event)).not.toThrow();
    });

    it('gives the same answer before the Categorizer has applied the correction', async () => {
      const { repos, ctx, agent } = await setup(7000);
      // The row still shows the previous category.
      await repos.transactions.insert(tx(2, { amountMinor: 4000, categoryId: 'food.dining' }));
      const out = await agent.handle(userCorrected(id(2), 'food.dining', 'food.coffee'), ctx);
      expect(out[0]).toMatchObject({ payload: { budgetId: COFFEE_BUDGET, percentUsed: 110 } });
    });

    it('ignores superseded, no-op and non-spending corrections', async () => {
      const { repos, ctx, agent } = await setup(7000);
      // A later correction already moved the row on to Groceries.
      await repos.transactions.insert(tx(2, { amountMinor: 4000, categoryId: 'food.groceries' }));
      expect(await agent.handle(userCorrected(id(2), 'food.dining', 'food.coffee'), ctx)).toEqual(
        [],
      );
      await repos.transactions.insert(tx(3, { amountMinor: 4000 }));
      expect(await agent.handle(userCorrected(id(3), 'food.coffee', 'food.coffee'), ctx)).toEqual(
        [],
      );
      await repos.transactions.insert(tx(4, { amountMinor: 4000, kind: 'income' }));
      expect(await agent.handle(userCorrected(id(4), 'food.dining', 'food.coffee'), ctx)).toEqual(
        [],
      );
    });

    it('does not warn when moving spending out of a budget', async () => {
      const { repos, ctx, agent } = await setup(9500);
      await repos.transactions.insert(tx(2, { amountMinor: 4000, categoryId: 'food.dining' }));
      expect(await agent.handle(userCorrected(id(2), 'food.coffee', 'food.dining'), ctx)).toEqual(
        [],
      );
    });

    it('warns once for one change, however it is announced', async () => {
      const { repos, ctx, agent } = await setup(7000);
      // A manual entry the user categorized: categorized(source user) + reconciled 'new'.
      await repos.transactions.insert(tx(2, { amountMinor: 4000, categorySource: 'user' }));
      const fromCategorized = await agent.handle(categorized(id(2), 'food.coffee', 'user'), ctx);
      const fromReconciled = await agent.handle(reconciled(id(2)), ctx);
      expect(fromCategorized).toEqual([]);
      expect(fromReconciled.filter((e) => e.type === 'notify.request')).toHaveLength(1);
    });
  });

  it('subtracts linked refunds before deciding', async () => {
    const { repos, ctx, agent } = await setup(7000);
    await repos.transactions.insert(
      tx(5, { amountMinor: 1000, kind: 'refund', linkedTransactionId: id(1) }),
    );
    await repos.transactions.insert(tx(2, { amountMinor: 1000 }));
    // 70 - 10 + 10 = 70%: nothing crossed.
    expect(await agent.handle(reconciled(id(2)), ctx)).toEqual([]);
  });

  it('only warns for the current local month', async () => {
    const { repos, ctx, agent, clock } = await setup(7000);
    // Late capture of a September purchase (Sep 30, 23:00 New York).
    await repos.transactions.insert(
      tx(2, { amountMinor: 9000, occurredAt: '2026-10-01T03:00:00.000Z' }),
    );
    expect(await agent.handle(reconciled(id(2)), ctx)).toEqual([]);

    // The same instant is October in UTC, so a UTC user would be warned.
    const utcAgent = createBudgetCoach({
      transactions: repos.transactions,
      budgets: repos.budgets,
      timeZone: 'UTC',
    });
    clock.set('2026-10-15T16:00:00.000Z');
    expect((await utcAgent.handle(reconciled(id(2)), ctx)).length).toBeGreaterThan(0);
  });

  it('skips zero budgets and other currencies', async () => {
    const { repos, ctx, agent } = await setup(7000, [
      budget(COFFEE_BUDGET, 'food.coffee', 0),
      { ...budget(OVERALL_BUDGET, null, 1000), currency: 'EUR' },
    ]);
    await repos.transactions.insert(tx(2, { amountMinor: 3000 }));
    expect(await agent.handle(reconciled(id(2)), ctx)).toEqual([]);
  });
});

describe('Budget Coach weekly check-in', () => {
  // Sunday 2026-10-18, 18:00 in New York (EDT) is 22:00 UTC.
  const SLOT = '2026-10-18T22:00:00.000Z';
  const CHECKIN = {
    type: 'notify.request',
    payload: { kind: 'weekly_checkin', urgency: 'instant' },
  };

  function checkinSetup(options: Partial<Parameters<typeof createBudgetCoach>[0]> = {}) {
    const repos = createInMemoryRepos();
    const clock = createFixedClock(SLOT);
    const ctx = { now: clock, llm: createNoopLlm(), log: createCapturingLogger() };
    const store = new InMemoryLastCheckinStore();
    const make = () =>
      createBudgetCoach({
        transactions: repos.transactions,
        budgets: repos.budgets,
        timeZone: NY,
        lastCheckinStore: store,
        ...options,
      });
    return { ctx, clock, store, make, agent: make() };
  }

  it('emits once per local week, at or after Sunday 18:00', async () => {
    const { ctx, clock, store, agent, make } = checkinSetup();

    clock.set('2026-10-18T21:59:00.000Z');
    expect(await agent.tick!(ctx)).toEqual([]);

    clock.set(SLOT);
    const out = await agent.tick!(ctx);
    expect(out).toEqual([CHECKIN]);
    for (const event of out) expect(() => parseNewEvent(event)).not.toThrow();
    expect(store.value).toBe('2026-10-18');

    clock.set('2026-10-19T13:00:00.000Z');
    expect(await agent.tick!(ctx)).toEqual([]);
    // A restarted agent with the same store remembers.
    expect(await make().tick!(ctx)).toEqual([]);

    clock.set('2026-10-25T22:00:00.000Z');
    expect(await agent.tick!(ctx)).toEqual([CHECKIN]);
  });

  it('sends a late check-in within the grace period, then gives up', async () => {
    const late = checkinSetup();
    late.clock.set('2026-10-19T13:00:00.000Z'); // Monday 09:00 New York
    expect(await late.agent.tick!(late.ctx)).toEqual([CHECKIN]);

    const tooLate = checkinSetup();
    tooLate.clock.set('2026-10-21T13:00:00.000Z'); // Wednesday
    expect(await tooLate.agent.tick!(tooLate.ctx)).toEqual([]);
    expect(tooLate.store.value).toBeNull();
  });

  it('uses the configured day and time, or none', async () => {
    const friday = checkinSetup({ weeklyCheckin: { dayOfWeek: 5, time: '08:30' } });
    friday.clock.set('2026-10-16T12:30:00.000Z'); // Friday 08:30 New York
    expect(await friday.agent.tick!(friday.ctx)).toEqual([CHECKIN]);
    expect(friday.store.value).toBe('2026-10-16');

    const off = checkinSetup({ weeklyCheckin: null });
    expect(await off.agent.tick!(off.ctx)).toEqual([]);
  });

  it('rejects an invalid schedule', () => {
    expect(() => checkinSetup({ weeklyCheckin: { dayOfWeek: 7, time: '18:00' } })).toThrow(
      RangeError,
    );
    expect(() => checkinSetup({ weeklyCheckin: { dayOfWeek: 0, time: '24:00' } })).toThrow(
      RangeError,
    );
  });

  it('finds the slot in local time across a DST change', () => {
    // US DST ends Sunday 2026-11-01: 18:00 EST is 23:00 UTC.
    expect(
      latestCheckinSlot(new Date('2026-11-01T23:30:00.000Z'), DEFAULT_WEEKLY_CHECKIN, NY),
    ).toEqual({ at: new Date('2026-11-01T23:00:00.000Z'), date: '2026-11-01' });
    // Just before it, the previous Sunday (EDT) is the latest slot.
    expect(
      latestCheckinSlot(new Date('2026-11-01T22:30:00.000Z'), DEFAULT_WEEKLY_CHECKIN, NY),
    ).toEqual({ at: new Date('2026-10-25T22:00:00.000Z'), date: '2026-10-25' });
  });
});
