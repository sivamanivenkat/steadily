import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type NewEvent, type Transaction } from '@steadily/shared-types';
import { InMemoryEventStore } from '../event-store';
import { createInMemoryRepos, type Budget } from '../ports';
import { AgentRuntime } from '../runtime';
import {
  createCapturingLogger,
  createFixedClock,
  createNoopLlm,
  createSequentialIds,
} from '../testing';
import { createBudgetCoach } from './budget-coach';
import { createNotifier, InMemoryNotificationSink } from './notifier';
import { createSubscriptionWatcher } from './subscription-watcher';

// Synthetic data only.
const NY = 'America/New_York';
const id = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const STREAM = 'Synthetic Stream';
const COFFEE_BUDGET = id(501);

function tx(n: number, overrides: Partial<Transaction>): Transaction {
  return {
    id: id(n),
    createdAt: '2026-10-15T16:00:00.000Z',
    updatedAt: '2026-10-15T16:00:00.000Z',
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

const coffeeBudget: Budget = {
  id: COFFEE_BUDGET,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  deletedAt: null,
  categoryId: 'food.coffee',
  period: 'monthly',
  amountMinor: 10000,
  currency: 'USD',
  rollover: false,
};

const TRANSACTIONS = [
  // Coffee: $70 already spent, then $25 pushes the $100 budget to 95%.
  tx(1, { amountMinor: 7000, occurredAt: '2026-10-05T12:00:00.000Z' }),
  tx(2, { amountMinor: 2500, occurredAt: '2026-10-14T12:00:00.000Z', status: 'needs_review' }),
  // Streaming: three monthly charges, the last one at a higher price.
  tx(11, {
    merchantName: STREAM,
    amountMinor: 1599,
    categoryId: 'subscriptions.general',
    occurredAt: '2026-08-03T12:00:00.000Z',
  }),
  tx(12, {
    merchantName: STREAM,
    amountMinor: 1599,
    categoryId: 'subscriptions.general',
    occurredAt: '2026-09-03T12:00:00.000Z',
  }),
  tx(13, {
    merchantName: STREAM,
    amountMinor: 1799,
    categoryId: 'subscriptions.general',
    occurredAt: '2026-10-03T12:00:00.000Z',
  }),
];

/** Upstream events as the Categorizer and Reconciler would emit them. */
function inputEvents(t: Transaction): NewEvent[] {
  const out: NewEvent[] = [];
  const needsReview = t.status === 'needs_review';
  out.push({
    type: 'transaction.categorized',
    payload: {
      transactionId: t.id,
      categoryId: t.categoryId,
      confidence: needsReview ? 0.5 : 0.95,
      source: needsReview ? 'classifier' : 'dictionary',
      needsReview,
    },
  });
  if (needsReview) {
    out.push({
      type: 'notify.request',
      payload: { kind: 'transaction_needs_review', urgency: 'instant', transactionId: t.id },
    });
  }
  out.push({ type: 'transaction.reconciled', payload: { transactionId: t.id, outcome: 'new' } });
  return out;
}

async function replay() {
  const repos = createInMemoryRepos();
  repos.settings.value = { ...DEFAULT_SETTINGS, notifyMode: 'unsure_only' };
  repos.budgets.rows.set(coffeeBudget.id, coffeeBudget);
  const store = new InMemoryEventStore();
  const sink = new InMemoryNotificationSink();
  const log = createCapturingLogger();
  // Noon in New York: outside the default quiet hours.
  const clock = createFixedClock('2026-10-15T16:00:00.000Z');
  const runtime = new AgentRuntime({
    store,
    log,
    clock,
    newId: createSequentialIds(),
    llm: createNoopLlm(),
  });
  runtime
    .register(
      createBudgetCoach({ transactions: repos.transactions, budgets: repos.budgets, timeZone: NY }),
    )
    .register(
      createSubscriptionWatcher({
        transactions: repos.transactions,
        subscriptions: repos.subscriptions,
        newId: () => id(900),
      }),
    )
    .register(createNotifier({ settings: repos.settings, sink, timeZone: NY }));

  // Transactions arrive one by one, like captures over time.
  for (const t of TRANSACTIONS) {
    await repos.transactions.insert(t);
    for (const event of inputEvents(t)) {
      await runtime.bus.publish([event], null);
      await runtime.runUntilIdle();
    }
  }
  const events = (await store.readAfter(0)).map(({ event }) => event);
  return { events, sink, repos, log, runtime };
}

describe('replay: Budget Coach + Subscription Watcher + Notifier', () => {
  it('turns upstream events into the expected events and notifications', async () => {
    const { events, sink, repos, log } = await replay();
    const emitted = events.filter((e) => e.causationId !== null);

    expect(emitted.map((e) => ({ type: e.type, payload: e.payload }))).toEqual([
      {
        type: 'budget.threshold_crossed',
        payload: {
          budgetId: COFFEE_BUDGET,
          categoryId: 'food.coffee',
          percentUsed: 95,
          percentOfPeriodElapsed: 46.8,
        },
      },
      {
        type: 'notify.request',
        payload: {
          kind: 'budget_warning',
          urgency: 'summary',
          budgetId: COFFEE_BUDGET,
          transactionId: id(2),
          threshold: 90,
        },
      },
      {
        // Subscriptions category: detected on the second monthly charge.
        type: 'subscription.detected',
        payload: {
          subscriptionId: id(900),
          merchantName: STREAM,
          cadence: 'monthly',
          amountMinor: 1599,
          currency: 'USD',
        },
      },
      {
        type: 'subscription.price_changed',
        payload: {
          subscriptionId: id(900),
          merchantName: STREAM,
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
          transactionId: id(13),
        },
      },
    ]);

    // unsure_only: needs-review now, the rest into the daily summary.
    expect(sink.delivered.map((n) => n.kind)).toEqual(['transaction_needs_review']);
    expect(sink.queued.map((n) => n.kind)).toEqual(['budget_warning', 'subscription_price_up']);
    expect(repos.subscriptions.rows.get(id(900))).toMatchObject({
      amountMinor: 1799,
      nextDueAt: '2026-11-03T12:00:00.000Z',
    });
    expect(log.entries.filter((e) => e.level !== 'info')).toEqual([]);
  });

  it('warns instantly when a correction pushes a budget over 100%', async () => {
    const { runtime, repos, sink } = await replay();
    // $12 of dining, then the user moves it to Coffee: 95% -> 107%.
    await repos.transactions.insert(
      tx(3, {
        amountMinor: 1200,
        categoryId: 'food.dining',
        occurredAt: '2026-10-12T12:00:00.000Z',
      }),
    );
    for (const event of inputEvents((await repos.transactions.get(id(3)))!)) {
      await runtime.bus.publish([event], null);
      await runtime.runUntilIdle();
    }
    await runtime.bus.publish(
      [
        {
          type: 'transaction.user_corrected',
          payload: {
            transactionId: id(3),
            previousCategoryId: 'food.dining',
            categoryId: 'food.coffee',
            applyToSimilar: false,
          },
        },
      ],
      null,
    );
    await runtime.runUntilIdle();

    expect(sink.delivered.map((n) => [n.kind, n.threshold])).toEqual([
      ['transaction_needs_review', undefined],
      ['budget_warning', 100],
    ]);
    expect(sink.delivered[1]).toEqual({
      requestId: expect.any(String),
      kind: 'budget_warning',
      budgetId: COFFEE_BUDGET,
      transactionId: id(3),
      threshold: 100,
    });
  });

  it('is deterministic and idempotent', async () => {
    const first = await replay();
    const second = await replay();
    const strip = (r: typeof first) => r.events.map(({ type, payload }) => ({ type, payload }));
    expect(strip(second)).toEqual(strip(first));
    expect(second.sink.delivered).toEqual(first.sink.delivered);

    // Running again delivers nothing new.
    const again = await first.runtime.runUntilIdle();
    expect(again.deliveries).toBe(0);
    expect(first.sink.delivered).toHaveLength(1);
  });
});
