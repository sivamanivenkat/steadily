import { describe, expect, it } from 'vitest';
import { parseNewEvent, type StoredEvent, type Transaction } from '@steadily/shared-types';
import { createInMemoryRepos, type Subscription } from '../ports';
import {
  createCapturingLogger,
  createFixedClock,
  createNoopLlm,
  createSequentialIds,
} from '../testing';
import {
  createSubscriptionWatcher,
  detectRecurring,
  fitsCadence,
  isPriceChange,
} from './subscription-watcher';

// Synthetic data only.
const id = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const MERCHANT = 'Synthetic Stream';

function tx(n: number, occurredAt: string, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: id(n),
    createdAt: occurredAt,
    updatedAt: occurredAt,
    deletedAt: null,
    occurredAt,
    amountMinor: 1599,
    currency: 'USD',
    kind: 'expense',
    merchantRaw: null,
    merchantName: MERCHANT,
    categoryId: 'entertainment.general',
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

let eventSeq = 0;
function categorized(t: Transaction): StoredEvent {
  return {
    id: id(2000 + ++eventSeq),
    type: 'transaction.categorized',
    at: t.occurredAt,
    causationId: null,
    payload: {
      transactionId: t.id,
      categoryId: t.categoryId,
      confidence: 0.95,
      source: 'dictionary',
      needsReview: false,
    },
  };
}

function setup() {
  const repos = createInMemoryRepos();
  const clock = createFixedClock('2026-10-15T16:00:00.000Z');
  const ctx = { now: clock, llm: createNoopLlm(), log: createCapturingLogger() };
  const newId = createSequentialIds();
  const agent = createSubscriptionWatcher({
    transactions: repos.transactions,
    subscriptions: repos.subscriptions,
    newId,
  });
  /** Inserts the charges and handles their categorized events, returning the last output. */
  const charge = async (...txs: Transaction[]) => {
    let out: Awaited<ReturnType<typeof agent.handle>> = [];
    for (const t of txs) {
      await repos.transactions.insert(t);
      out = await agent.handle(categorized(t), ctx);
    }
    return out;
  };
  return { repos, ctx, agent, charge };
}

function existing(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: id(900),
    createdAt: '2026-09-03T12:00:00.000Z',
    updatedAt: '2026-09-03T12:00:00.000Z',
    deletedAt: null,
    merchantName: MERCHANT,
    cadence: 'monthly',
    amountMinor: 1599,
    currency: 'USD',
    categoryId: 'entertainment.general',
    lastChargedAt: '2026-09-03T12:00:00.000Z',
    nextDueAt: '2026-10-03T12:00:00.000Z',
    dismissed: false,
    ...overrides,
  };
}

describe('detectRecurring', () => {
  const at = (iso: string, amountMinor = 1000) => ({ occurredAt: iso, amountMinor });

  it('detects monthly, weekly, quarterly and yearly runs', () => {
    expect(
      detectRecurring([
        at('2026-07-31T12:00:00Z'),
        at('2026-08-31T12:00:00Z'),
        at('2026-09-30T12:00:00Z'),
      ]),
    ).toEqual({
      cadence: 'monthly',
      lastChargedAt: '2026-09-30T12:00:00Z',
      amountMinor: 1000,
      count: 3,
    });
    expect(
      detectRecurring([
        at('2026-10-01T12:00:00Z'),
        at('2026-10-08T12:00:00Z'),
        at('2026-10-14T12:00:00Z'),
      ])?.cadence,
    ).toBe('weekly');
    expect(
      detectRecurring([
        at('2026-01-15T12:00:00Z'),
        at('2026-04-15T12:00:00Z'),
        at('2026-07-15T12:00:00Z'),
      ])?.cadence,
    ).toBe('quarterly');
    expect(
      detectRecurring([
        at('2024-03-01T12:00:00Z'),
        at('2025-03-01T12:00:00Z'),
        at('2026-03-01T12:00:00Z'),
      ])?.cadence,
    ).toBe('yearly');
  });

  it('allows small amount changes and input in any order', () => {
    const result = detectRecurring([
      at('2026-09-03T12:00:00Z', 1100),
      at('2026-07-03T12:00:00Z', 1000),
      at('2026-08-03T12:00:00Z', 1050),
    ]);
    expect(result).toMatchObject({ cadence: 'monthly', amountMinor: 1100, count: 3 });
  });

  it('rejects irregular gaps, varying amounts, too few charges and same-day duplicates', () => {
    expect(
      detectRecurring([
        at('2026-07-03T12:00:00Z'),
        at('2026-07-13T12:00:00Z'),
        at('2026-08-27T12:00:00Z'),
      ]),
    ).toBeNull();
    expect(
      detectRecurring([
        at('2026-07-03T12:00:00Z', 1000),
        at('2026-08-03T12:00:00Z', 1400),
        at('2026-09-03T12:00:00Z', 1000),
      ]),
    ).toBeNull();
    expect(detectRecurring([at('2026-08-03T12:00:00Z'), at('2026-09-03T12:00:00Z')])).toBeNull();
    // A duplicate capture of one charge is not a second charge.
    expect(
      detectRecurring([
        at('2026-08-03T12:00:00Z'),
        at('2026-08-03T18:00:00Z'),
        at('2026-09-03T12:00:00Z'),
      ]),
    ).toBeNull();
  });

  it('needs only 2 charges when asked', () => {
    expect(
      detectRecurring([at('2026-08-03T12:00:00Z'), at('2026-09-03T12:00:00Z')], 2)?.cadence,
    ).toBe('monthly');
  });

  it('uses the run ending at the latest charge', () => {
    // Old weekly run, then a single unrelated charge much later: nothing current.
    expect(
      detectRecurring([
        at('2026-01-01T12:00:00Z'),
        at('2026-01-08T12:00:00Z'),
        at('2026-01-15T12:00:00Z'),
        at('2026-05-01T12:00:00Z'),
      ]),
    ).toBeNull();
  });
});

describe('fitsCadence and isPriceChange', () => {
  it('uses the documented windows', () => {
    expect(fitsCadence(5, 'weekly', 1)).toBe(true);
    expect(fitsCadence(9, 'weekly', 1)).toBe(true);
    expect(fitsCadence(9.5, 'weekly', 1)).toBe(false);
    expect(fitsCadence(27.9, 'monthly', 1)).toBe(false);
    expect(fitsCadence(33, 'monthly', 1)).toBe(true);
    expect(fitsCadence(61, 'monthly', 2)).toBe(true);
  });

  it('needs more than 1% and more than $0.50', () => {
    expect(isPriceChange(1599, 1799)).toBe(true);
    expect(isPriceChange(1599, 1649)).toBe(false); // $0.50 exactly
    expect(isPriceChange(1599, 1650)).toBe(true);
    expect(isPriceChange(100000, 100900)).toBe(false); // 0.9%
    expect(isPriceChange(100000, 101001)).toBe(true);
    expect(isPriceChange(1799, 1599)).toBe(true); // decreases count too
  });
});

describe('Subscription Watcher', () => {
  it('detects a monthly subscription on the third charge and stores it', async () => {
    const { repos, charge } = setup();
    expect(
      await charge(tx(1, '2026-07-03T12:00:00.000Z'), tx(2, '2026-08-03T12:00:00.000Z')),
    ).toEqual([]);
    const out = await charge(tx(3, '2026-09-03T12:00:00.000Z'));
    expect(out).toEqual([
      {
        type: 'subscription.detected',
        payload: {
          subscriptionId: '00000000-0000-4000-8000-000000000001',
          merchantName: MERCHANT,
          cadence: 'monthly',
          amountMinor: 1599,
          currency: 'USD',
        },
      },
    ]);
    for (const event of out) expect(() => parseNewEvent(event)).not.toThrow();
    expect([...repos.subscriptions.rows.values()]).toEqual([
      expect.objectContaining({
        cadence: 'monthly',
        lastChargedAt: '2026-09-03T12:00:00.000Z',
        nextDueAt: '2026-10-03T12:00:00.000Z',
        categoryId: 'entertainment.general',
        createdAt: '2026-10-15T16:00:00.000Z',
      }),
    ]);
  });

  it('detects weekly charges', async () => {
    const { charge } = setup();
    const out = await charge(
      tx(1, '2026-09-24T12:00:00.000Z', { amountMinor: 1200 }),
      tx(2, '2026-10-01T12:00:00.000Z', { amountMinor: 1200 }),
      tx(3, '2026-10-08T12:00:00.000Z', { amountMinor: 1250 }),
    );
    expect(out).toMatchObject([{ payload: { cadence: 'weekly', amountMinor: 1250 } }]);
  });

  it('detects from 2 charges in the Subscriptions category only', async () => {
    const other = setup();
    expect(
      await other.charge(tx(1, '2026-08-03T12:00:00.000Z'), tx(2, '2026-09-03T12:00:00.000Z')),
    ).toEqual([]);

    const subs = setup();
    const category = { categoryId: 'subscriptions.general' } as const;
    const out = await subs.charge(
      tx(1, '2026-08-03T12:00:00.000Z', category),
      tx(2, '2026-09-03T12:00:00.000Z', category),
    );
    expect(out).toMatchObject([{ type: 'subscription.detected' }]);
  });

  it('ignores irregular charges, income, refunds and other merchants', async () => {
    const { charge } = setup();
    expect(
      await charge(
        tx(1, '2026-07-03T12:00:00.000Z'),
        tx(2, '2026-07-20T12:00:00.000Z'),
        tx(3, '2026-09-03T12:00:00.000Z'),
      ),
    ).toEqual([]);

    const second = setup();
    expect(
      await second.charge(
        tx(1, '2026-07-03T12:00:00.000Z'),
        tx(2, '2026-08-03T12:00:00.000Z', { kind: 'refund' }),
        tx(3, '2026-09-03T12:00:00.000Z'),
        tx(4, '2026-10-03T12:00:00.000Z', { merchantName: 'Synthetic Other' }),
        tx(5, '2026-10-04T12:00:00.000Z', { merchantName: null }),
      ),
    ).toEqual([]);
  });

  it('reports a price increase on an existing subscription and asks the Notifier', async () => {
    const { repos, charge } = setup();
    await repos.subscriptions.upsert(existing());
    const out = await charge(tx(1, '2026-10-03T12:00:00.000Z', { amountMinor: 1799 }));
    expect(out).toEqual([
      {
        type: 'subscription.price_changed',
        payload: {
          subscriptionId: id(900),
          merchantName: MERCHANT,
          previousAmountMinor: 1599,
          amountMinor: 1799,
          currency: 'USD',
        },
      },
      {
        type: 'notify.request',
        payload: {
          kind: 'subscription_price_up',
          urgency: 'instant',
          subscriptionId: id(900),
          transactionId: id(1),
        },
      },
    ]);
    for (const event of out) expect(() => parseNewEvent(event)).not.toThrow();
    expect(repos.subscriptions.rows.get(id(900))).toMatchObject({
      amountMinor: 1799,
      lastChargedAt: '2026-10-03T12:00:00.000Z',
      nextDueAt: '2026-11-03T12:00:00.000Z',
      updatedAt: '2026-10-15T16:00:00.000Z',
    });
  });

  it('moves the subscription forward quietly for small changes and after a missed month', async () => {
    const { repos, charge } = setup();
    await repos.subscriptions.upsert(existing());
    expect(await charge(tx(1, '2026-11-03T12:00:00.000Z', { amountMinor: 1620 }))).toEqual([]);
    expect(repos.subscriptions.rows.get(id(900))).toMatchObject({
      amountMinor: 1620,
      lastChargedAt: '2026-11-03T12:00:00.000Z',
    });
  });

  it('leaves the subscription alone for unrelated purchases, old charges and re-delivery', async () => {
    const { repos, ctx, agent, charge } = setup();
    await repos.subscriptions.upsert(existing());
    const before = repos.subscriptions.rows.get(id(900));

    // 10 days after the last charge: not the next charge.
    expect(await charge(tx(1, '2026-09-13T12:00:00.000Z', { amountMinor: 4999 }))).toEqual([]);
    // Right cadence, but 3x the price: a different purchase.
    expect(await charge(tx(2, '2026-10-03T12:00:00.000Z', { amountMinor: 4999 }))).toEqual([]);
    // Older than the last known charge.
    expect(await charge(tx(3, '2026-08-03T12:00:00.000Z', { amountMinor: 1899 }))).toEqual([]);
    expect(repos.subscriptions.rows.get(id(900))).toEqual(before);

    const next = tx(4, '2026-10-03T12:00:00.000Z', { amountMinor: 1799 });
    const event = categorized(next);
    await repos.transactions.insert(next);
    expect(await agent.handle(event, ctx)).toHaveLength(2);
    expect(await agent.handle(event, ctx)).toEqual([]);
  });

  it('respects a dismissed subscription', async () => {
    const { repos, charge } = setup();
    await repos.subscriptions.upsert(existing({ dismissed: true }));
    const out = await charge(
      tx(1, '2026-10-03T12:00:00.000Z', { amountMinor: 1799 }),
      tx(2, '2026-11-03T12:00:00.000Z', { amountMinor: 1799 }),
    );
    expect(out).toEqual([]);
    expect(repos.subscriptions.rows.size).toBe(1);
  });
});
