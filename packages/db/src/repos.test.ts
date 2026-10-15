import { beforeEach, describe, expect, it } from 'vitest';
import type { Budget, InboxItem, Subscription, UserRule } from '@steadily/agent-core';
import { DEFAULT_SETTINGS, type Transaction } from '@steadily/shared-types';
import { createTestDb, type NodeDb } from './node';
import { createRepos, insertInboxItem, saveSettings } from './repos';
import * as schema from './schema';

// Synthetic data only.
const T0 = '2026-10-01T00:00:00.000Z';
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

function txn(n: number, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: id(n),
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    occurredAt: `2026-10-${String(n).padStart(2, '0')}T12:00:00.000Z`,
    amountMinor: 450,
    currency: 'USD',
    kind: 'expense',
    merchantRaw: 'SYNTHETIC CAFE #1',
    merchantName: 'Synthetic Cafe',
    categoryId: 'food.coffee',
    categoryConfidence: 0.9,
    categorySource: 'dictionary',
    status: 'confirmed',
    source: 'android_notification',
    accountLast4: '0000',
    issuerId: 'synthbank',
    txnRef: null,
    note: null,
    linkedTransactionId: null,
    ...overrides,
  };
}

function rule(n: number, overrides: Partial<UserRule> = {}): UserRule {
  return {
    id: id(100 + n),
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    matchType: 'merchant_contains',
    pattern: 'cafe',
    categoryId: 'food.coffee',
    kind: null,
    hits: 0,
    ...overrides,
  };
}

function subscription(n: number, overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: id(200 + n),
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    merchantName: `Synthetic Stream ${n}`,
    cadence: 'monthly',
    amountMinor: 999,
    currency: 'USD',
    categoryId: 'subscriptions.general',
    lastChargedAt: T0,
    nextDueAt: null,
    dismissed: false,
    ...overrides,
  };
}

let db: NodeDb;
let repos: ReturnType<typeof createRepos>;

beforeEach(() => {
  db = createTestDb().db;
  repos = createRepos(db);
});

describe('SqliteTransactionRepo', () => {
  it('round-trips every field, including nulls', async () => {
    const full = txn(1, {
      deletedAt: null,
      txnRef: 'REF1',
      note: 'synthetic note',
      linkedTransactionId: id(2),
      categoryConfidence: 0.42,
      status: 'needs_review',
    });
    await repos.transactions.insert(full);
    expect(await repos.transactions.get(full.id)).toEqual(full);

    const sparse = txn(2, {
      merchantRaw: null,
      merchantName: null,
      accountLast4: null,
      issuerId: null,
    });
    await repos.transactions.insert(sparse);
    expect(await repos.transactions.get(sparse.id)).toEqual(sparse);
    expect(await repos.transactions.get(id(99))).toBeNull();
  });

  it('rejects duplicate ids', async () => {
    await repos.transactions.insert(txn(1));
    await expect(repos.transactions.insert(txn(1))).rejects.toThrow();
  });

  it('updates only patched fields and can clear them with null', async () => {
    await repos.transactions.insert(txn(1, { note: 'x' }));
    await repos.transactions.update(id(1), {
      categoryId: 'food.groceries',
      status: 'needs_review',
      note: null,
      updatedAt: '2026-10-02T00:00:00.000Z',
    });
    expect(await repos.transactions.get(id(1))).toEqual(
      txn(1, {
        categoryId: 'food.groceries',
        status: 'needs_review',
        note: null,
        updatedAt: '2026-10-02T00:00:00.000Z',
      }),
    );
    // Empty patch on an existing row is a no-op.
    await repos.transactions.update(id(1), {});
  });

  it('throws when updating an unknown id', async () => {
    await expect(repos.transactions.update(id(9), { note: 'x' })).rejects.toThrow(
      'Unknown transaction id',
    );
    await expect(repos.transactions.update(id(9), {})).rejects.toThrow('Unknown transaction id');
  });

  it('findByTxnRef matches issuer (including null) and skips deleted rows', async () => {
    await repos.transactions.insert(txn(1, { txnRef: 'R1' }));
    await repos.transactions.insert(txn(2, { txnRef: 'R1', issuerId: 'otherbank' }));
    await repos.transactions.insert(txn(3, { txnRef: 'R1', issuerId: null }));
    await repos.transactions.insert(txn(4, { txnRef: 'R1', deletedAt: T0 }));
    expect((await repos.transactions.findByTxnRef('synthbank', 'R1')).map((t) => t.id)).toEqual([
      id(1),
    ]);
    expect((await repos.transactions.findByTxnRef(null, 'R1')).map((t) => t.id)).toEqual([id(3)]);
    expect(await repos.transactions.findByTxnRef('synthbank', 'R2')).toEqual([]);
  });

  it('findInWindow is inclusive on both ends and filters by amount', async () => {
    await repos.transactions.insert(txn(1));
    await repos.transactions.insert(txn(2, { amountMinor: 999 }));
    await repos.transactions.insert(txn(3));
    await repos.transactions.insert(txn(4, { deletedAt: T0 }));
    const window = { from: txn(1).occurredAt, to: txn(4).occurredAt };
    expect((await repos.transactions.findInWindow(window)).map((t) => t.id)).toEqual([
      id(1),
      id(2),
      id(3),
    ]);
    expect(
      (await repos.transactions.findInWindow({ ...window, amountMinor: 999 })).map((t) => t.id),
    ).toEqual([id(2)]);
  });

  it('listByMerchant is most recent first, limited, without deleted rows', async () => {
    for (const n of [1, 2, 3]) await repos.transactions.insert(txn(n));
    await repos.transactions.insert(txn(4, { deletedAt: T0 }));
    await repos.transactions.insert(txn(5, { merchantName: 'Other' }));
    expect((await repos.transactions.listByMerchant('Synthetic Cafe')).map((t) => t.id)).toEqual([
      id(3),
      id(2),
      id(1),
    ]);
    expect((await repos.transactions.listByMerchant('Synthetic Cafe', 2)).map((t) => t.id)).toEqual(
      [id(3), id(2)],
    );
  });

  it('listBetween is half-open, oldest first, without deleted rows', async () => {
    for (const n of [3, 1, 2]) await repos.transactions.insert(txn(n));
    await repos.transactions.insert(txn(4, { deletedAt: T0, occurredAt: txn(2).occurredAt }));
    expect(
      (await repos.transactions.listBetween(txn(1).occurredAt, txn(3).occurredAt)).map((t) => t.id),
    ).toEqual([id(1), id(2)]);
  });
});

describe('SqliteInboxRepo', () => {
  const item = (n: number, expiresAt: string): InboxItem => ({
    id: id(300 + n),
    createdAt: T0,
    expiresAt,
    source: 'share_text',
    rawText: 'Synthetic alert text',
    originApp: n === 1 ? 'com.example.bank' : null,
    originSender: null,
  });

  it('inserts, gets and deletes items', async () => {
    insertInboxItem(db, item(1, '2026-10-02T00:00:00.000Z'));
    expect(await repos.inbox.get(id(301))).toEqual(item(1, '2026-10-02T00:00:00.000Z'));
    await repos.inbox.delete(id(301));
    expect(await repos.inbox.get(id(301))).toBeNull();
    await repos.inbox.delete(id(301));
  });

  it('purges items with expiresAt <= now', async () => {
    insertInboxItem(db, item(1, '2026-10-01T00:00:00.000Z'));
    insertInboxItem(db, item(2, '2026-10-02T00:00:00.000Z'));
    insertInboxItem(db, item(3, '2026-10-03T00:00:00.000Z'));
    expect(await repos.inbox.purgeExpired('2026-10-02T00:00:00.000Z')).toBe(2);
    expect(await repos.inbox.get(id(303))).not.toBeNull();
    expect(await repos.inbox.purgeExpired('2026-10-02T00:00:00.000Z')).toBe(0);
  });
});

describe('SqliteUserRuleRepo', () => {
  it('prefers an exact match over any contains match', async () => {
    await repos.userRules.upsert(rule(1, { pattern: 'synthetic cafe downtown' }));
    await repos.userRules.upsert(
      rule(2, {
        matchType: 'merchant_exact',
        pattern: 'synthetic cafe downtown',
        categoryId: 'food.dining',
      }),
    );
    expect((await repos.userRules.findForMerchant('synthetic cafe downtown'))?.id).toBe(id(102));
  });

  it('falls back to the longest contains pattern', async () => {
    await repos.userRules.upsert(rule(1, { pattern: 'cafe' }));
    await repos.userRules.upsert(rule(2, { pattern: 'synthetic cafe' }));
    await repos.userRules.upsert(rule(3, { pattern: 'grocer' }));
    expect((await repos.userRules.findForMerchant('synthetic cafe downtown'))?.id).toBe(id(102));
    expect((await repos.userRules.findForMerchant('corner cafe'))?.id).toBe(id(101));
    expect(await repos.userRules.findForMerchant('bookshop')).toBeNull();
  });

  it('ignores deleted rules and treats exact as exact', async () => {
    await repos.userRules.upsert(
      rule(1, { matchType: 'merchant_exact', pattern: 'cafe', deletedAt: T0 }),
    );
    await repos.userRules.upsert(rule(2, { pattern: 'synthetic cafe', deletedAt: T0 }));
    await repos.userRules.upsert(rule(3, { matchType: 'merchant_exact', pattern: 'caf' }));
    expect(await repos.userRules.findForMerchant('cafe')).toBeNull();
    expect(await repos.userRules.findForMerchant('synthetic cafe')).toBeNull();
  });

  it('treats LIKE wildcards in patterns literally', async () => {
    await repos.userRules.upsert(rule(1, { pattern: 'a%b' }));
    expect(await repos.userRules.findForMerchant('axxb')).toBeNull();
    expect((await repos.userRules.findForMerchant('xa%bx'))?.id).toBe(id(101));
  });

  it('upserts and increments hits', async () => {
    await repos.userRules.upsert(rule(1, { kind: 'expense' }));
    await repos.userRules.upsert(rule(1, { categoryId: 'food.dining', kind: null, hits: 5 }));
    await repos.userRules.incrementHits(id(101), '2026-10-05T00:00:00.000Z');
    await repos.userRules.incrementHits(id(999), '2026-10-05T00:00:00.000Z');
    expect(await repos.userRules.findForMerchant('cafe')).toEqual(
      rule(1, {
        categoryId: 'food.dining',
        kind: null,
        hits: 6,
        updatedAt: '2026-10-05T00:00:00.000Z',
      }),
    );
  });
});

describe('SqliteBudgetRepo', () => {
  it('lists non-deleted budgets with booleans and null categories mapped', async () => {
    const budget = (n: number, overrides: Partial<Budget> = {}): Budget => ({
      id: id(400 + n),
      createdAt: `2026-10-0${n}T00:00:00.000Z`,
      updatedAt: T0,
      deletedAt: null,
      categoryId: null,
      period: 'monthly',
      amountMinor: 100_000,
      currency: 'USD',
      rollover: false,
      ...overrides,
    });
    const rows = [
      budget(1),
      budget(2, { categoryId: 'food.coffee', rollover: true }),
      budget(3, { deletedAt: T0 }),
    ];
    for (const row of rows) db.insert(schema.budgets).values(row).run();
    expect(await repos.budgets.listActive()).toEqual([rows[0], rows[1]]);
  });
});

describe('SqliteSubscriptionRepo', () => {
  it('lists active subscriptions (not deleted, not dismissed)', async () => {
    await repos.subscriptions.upsert(subscription(1));
    await repos.subscriptions.upsert(subscription(2, { dismissed: true }));
    await repos.subscriptions.upsert(subscription(3, { deletedAt: T0 }));
    expect(await repos.subscriptions.listActive()).toEqual([subscription(1)]);
  });

  it('finds by merchant and cadence, skipping deleted rows', async () => {
    await repos.subscriptions.upsert(subscription(1, { nextDueAt: '2026-11-01T00:00:00.000Z' }));
    await repos.subscriptions.upsert(subscription(2, { deletedAt: T0 }));
    expect(await repos.subscriptions.findByMerchant('Synthetic Stream 1', 'monthly')).toEqual(
      subscription(1, { nextDueAt: '2026-11-01T00:00:00.000Z' }),
    );
    expect(await repos.subscriptions.findByMerchant('Synthetic Stream 1', 'yearly')).toBeNull();
    expect(await repos.subscriptions.findByMerchant('Synthetic Stream 2', 'monthly')).toBeNull();
  });

  it('upserts by id', async () => {
    await repos.subscriptions.upsert(subscription(1));
    await repos.subscriptions.upsert(subscription(1, { amountMinor: 1299, dismissed: true }));
    expect(await repos.subscriptions.findByMerchant('Synthetic Stream 1', 'monthly')).toEqual(
      subscription(1, { amountMinor: 1299, dismissed: true }),
    );
  });
});

describe('SqliteSettingsRepo', () => {
  it('returns defaults when nothing is stored', async () => {
    expect(await repos.settings.get()).toEqual(DEFAULT_SETTINGS);
  });

  it('merges stored keys over defaults, including null values', async () => {
    saveSettings(db, { cloudAiOptIn: true, quietHours: null }, T0);
    saveSettings(db, { theme: 'dark' }, T0);
    expect(await repos.settings.get()).toEqual({
      ...DEFAULT_SETTINGS,
      cloudAiOptIn: true,
      quietHours: null,
      theme: 'dark',
    });
  });

  it('falls back to the default for invalid stored values and ignores unknown keys', async () => {
    db.insert(schema.settings)
      .values([
        { key: 'notifyMode', value: 'sometimes', updatedAt: T0 },
        { key: 'dailySummary', value: false, updatedAt: T0 },
        { key: 'legacyKey', value: 1, updatedAt: T0 },
      ])
      .run();
    expect(await repos.settings.get()).toEqual({ ...DEFAULT_SETTINGS, dailySummary: false });
  });

  it('saveSettings rejects invalid values and unknown keys, storing nothing', async () => {
    expect(() => saveSettings(db, { theme: 'neon' as 'dark' }, T0)).toThrow();
    expect(() =>
      saveSettings(
        db,
        { cloudAiOptIn: true, bogus: 1 } as unknown as { cloudAiOptIn: boolean },
        T0,
      ),
    ).toThrow();
    expect(await repos.settings.get()).toEqual(DEFAULT_SETTINGS);
  });
});
