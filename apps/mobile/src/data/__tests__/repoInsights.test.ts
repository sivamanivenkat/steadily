import { createTestDb } from '@steadily/db/node';
import type { CategoryId } from '@steadily/taxonomy';

import { createRepoDataSource } from '../repoDataSource';
import { createSyntheticDataSource } from '../synthetic';
import { createAppLogger, createAppRuntime } from '../runtime';
import type { Transaction } from '../types';

/** Thursday, October 15 2026, 9:30 AM local time. */
const NOW = new Date(2026, 9, 15, 9, 30);
const on = (month: number, day: number) => new Date(2026, month, day, 12).toISOString();
const newId = () => globalThis.crypto.randomUUID();

function launch() {
  const { db } = createTestDb();
  const app = createAppRuntime(db, { newId, clock: () => NOW, log: createAppLogger(false) });
  const source = createRepoDataSource({ db, ...app, newId, now: () => NOW });
  return { db, source, ...app };
}

/** A synthetic transaction (made-up merchants and amounts). */
function tx(
  fields: Partial<Transaction> & { occurredAt: string; amountMinor: number },
): Transaction {
  return {
    id: newId(),
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

describe('repo data source: trends', () => {
  it('adds up months from the database like the budgets do', async () => {
    const { source, repos } = launch();
    const dining = tx({
      occurredAt: on(9, 4),
      amountMinor: 5_000,
      merchantName: 'Chipotle',
      categoryId: 'food.dining',
    });
    const rows = [
      dining,
      tx({
        occurredAt: on(9, 5),
        amountMinor: 1_000,
        kind: 'refund',
        merchantName: 'Chipotle',
        categoryId: 'food.dining',
        linkedTransactionId: dining.id,
      }),
      tx({
        occurredAt: on(9, 4),
        amountMinor: 5_000,
        merchantName: 'Chipotle',
        categoryId: 'food.dining',
        linkedTransactionId: dining.id,
      }),
      tx({ occurredAt: on(9, 6), amountMinor: 90_000, kind: 'income', merchantName: 'Payroll' }),
      tx({ occurredAt: on(9, 6), amountMinor: 8_000, currency: 'CAD', merchantName: 'Abroad' }),
      tx({
        occurredAt: on(8, 9),
        amountMinor: 2_500,
        merchantName: 'Target',
        categoryId: 'shopping.general',
      }),
    ];
    for (const row of rows) await repos.transactions.insert(row);

    const trends = await source.getTrends(NOW);
    expect(trends.totalMinor).toBe(4_000);
    expect(trends.previousTotalMinor).toBe(2_500);
    expect(trends.byCategory).toEqual([{ categoryId: 'food.dining', amountMinor: 4_000 }]);
    expect(trends.topMerchants).toEqual([{ name: 'Chipotle', amountMinor: 4_000, count: 1 }]);
    expect(trends.months.map((m) => m.totalMinor)).toEqual([0, 0, 0, 0, 2_500, 4_000]);
  });
});

describe('repo data source: subscriptions', () => {
  it('dismisses and restores a subscription, and lists its recent charges', async () => {
    const { source, repos } = launch();
    const netflix = {
      id: newId(),
      createdAt: on(9, 1),
      updatedAt: on(9, 1),
      deletedAt: null,
      merchantName: 'Netflix',
      cadence: 'monthly' as const,
      amountMinor: 1_799,
      currency: 'USD',
      categoryId: 'subscriptions.general' as CategoryId,
      lastChargedAt: on(9, 1),
      nextDueAt: on(10, 1),
      dismissed: false,
    };
    await repos.subscriptions.upsert(netflix);
    const charges = [
      tx({ occurredAt: on(7, 1), amountMinor: 1_549, merchantName: 'Netflix' }),
      tx({ occurredAt: on(8, 1), amountMinor: 1_549, merchantName: 'Netflix' }),
      tx({ occurredAt: on(9, 1), amountMinor: 1_799, merchantName: 'Netflix' }),
    ];
    const extra = [
      // A duplicate of the latest charge and a refund are not charges.
      tx({
        occurredAt: on(9, 1),
        amountMinor: 1_799,
        merchantName: 'Netflix',
        linkedTransactionId: charges[2]!.id,
      }),
      tx({ occurredAt: on(9, 2), amountMinor: 500, merchantName: 'Netflix', kind: 'refund' }),
      tx({ occurredAt: on(9, 3), amountMinor: 900, merchantName: 'Hulu' }),
    ];
    for (const row of [...charges, ...extra]) await repos.transactions.insert(row);

    expect((await source.listSubscriptionCharges(netflix.id)).map((t) => t.id)).toEqual(
      [...charges].reverse().map((t) => t.id),
    );
    expect(await source.listSubscriptionCharges(netflix.id, 1)).toHaveLength(1);
    expect(await source.listSubscriptionCharges('missing')).toEqual([]);

    const listener = jest.fn();
    source.subscribe(listener);
    await source.setSubscriptionDismissed(netflix.id, true);
    expect(listener).toHaveBeenCalled();
    expect(await source.listSubscriptions()).toEqual([]);

    await source.setSubscriptionDismissed(netflix.id, false);
    expect((await source.listSubscriptions()).map((s) => s.subscription.id)).toEqual([netflix.id]);
  });
});

describe('synthetic data source: subscriptions', () => {
  it('dismisses, restores and lists charges like the repo source', async () => {
    const source = createSyntheticDataSource({ now: () => NOW });
    const netflix = (await source.listSubscriptions()).find(
      (s) => s.subscription.merchantName === 'Netflix',
    )!;
    expect(
      (await source.listSubscriptionCharges(netflix.subscription.id)).map((t) => t.amountMinor),
    ).toEqual([1_799, 1_549]);

    await source.setSubscriptionDismissed(netflix.subscription.id, true);
    expect((await source.listSubscriptions()).map((s) => s.subscription.merchantName)).toEqual([
      'Spotify',
    ]);
    await source.setSubscriptionDismissed(netflix.subscription.id, false);
    expect(await source.listSubscriptions()).toHaveLength(2);
  });
});
