/**
 * SQLite implementations of the agent-core data ports (D-017).
 *
 * Rows are mapped to the port types field by field, so a schema column never
 * leaks onto a port object by accident. Soft-deleted rows (deleted_at set) are
 * filtered wherever the port says "non-deleted" or "active".
 */
import { and, asc, desc, eq, gte, isNull, lt, lte, sql } from 'drizzle-orm';
import type {
  Budget,
  BudgetRepo,
  InboxItem,
  InboxRepo,
  Repos,
  SettingsRepo,
  Subscription,
  SubscriptionRepo,
  TransactionPatch,
  TransactionRepo,
  UserRule,
  UserRuleRepo,
} from '@steadily/agent-core';
import { DEFAULT_SETTINGS, Settings, type Transaction } from '@steadily/shared-types';
import type { SteadilyDb } from './client';
import * as t from './schema';

type TransactionRow = typeof t.transactions.$inferSelect;
type UserRuleRow = typeof t.userRules.$inferSelect;
type BudgetRow = typeof t.budgets.$inferSelect;
type SubscriptionRow = typeof t.subscriptions.$inferSelect;
type InboxRow = typeof t.inbox.$inferSelect;

// ---------------------------------------------------------------------------
// Row <-> port mapping
// ---------------------------------------------------------------------------

const TRANSACTION_FIELDS = [
  'id',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'occurredAt',
  'amountMinor',
  'currency',
  'kind',
  'merchantRaw',
  'merchantName',
  'categoryId',
  'categoryConfidence',
  'categorySource',
  'status',
  'source',
  'accountLast4',
  'issuerId',
  'txnRef',
  'note',
  'linkedTransactionId',
] as const satisfies readonly (keyof Transaction & keyof TransactionRow)[];

function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    occurredAt: row.occurredAt,
    amountMinor: row.amountMinor,
    currency: row.currency,
    kind: row.kind,
    merchantRaw: row.merchantRaw,
    merchantName: row.merchantName,
    categoryId: row.categoryId,
    categoryConfidence: row.categoryConfidence,
    categorySource: row.categorySource,
    status: row.status,
    source: row.source,
    accountLast4: row.accountLast4,
    issuerId: row.issuerId,
    txnRef: row.txnRef,
    note: row.note,
    linkedTransactionId: row.linkedTransactionId,
  };
}

/** Only known columns with defined values; `null` is kept (it clears the column). */
function toTransactionSet(patch: TransactionPatch): Partial<TransactionRow> {
  const set: Record<string, unknown> = {};
  for (const field of TRANSACTION_FIELDS) {
    if (field === 'id' || field === 'createdAt') continue;
    const value = (patch as Record<string, unknown>)[field];
    if (value !== undefined) set[field] = value;
  }
  return set as Partial<TransactionRow>;
}

function toInboxItem(row: InboxRow): InboxItem {
  return {
    id: row.id,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    source: row.source,
    rawText: row.rawText,
    originApp: row.originApp,
    originSender: row.originSender,
  };
}

function toUserRule(row: UserRuleRow): UserRule {
  return {
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    matchType: row.matchType,
    pattern: row.pattern,
    categoryId: row.categoryId,
    kind: row.kind,
    hits: row.hits,
  };
}

function toBudget(row: BudgetRow): Budget {
  return {
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    categoryId: row.categoryId,
    period: row.period,
    amountMinor: row.amountMinor,
    currency: row.currency,
    rollover: row.rollover,
  };
}

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    merchantName: row.merchantName,
    cadence: row.cadence,
    amountMinor: row.amountMinor,
    currency: row.currency,
    categoryId: row.categoryId,
    lastChargedAt: row.lastChargedAt,
    nextDueAt: row.nextDueAt,
    dismissed: row.dismissed,
  };
}

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export class SqliteTransactionRepo implements TransactionRepo {
  constructor(private readonly db: SteadilyDb) {}

  async get(id: string) {
    const row = this.db.select().from(t.transactions).where(eq(t.transactions.id, id)).get();
    return row ? toTransaction(row) : null;
  }

  async insert(tx: Transaction) {
    const values = Object.fromEntries(TRANSACTION_FIELDS.map((f) => [f, tx[f]]));
    this.db
      .insert(t.transactions)
      .values(values as TransactionRow)
      .run();
  }

  async update(id: string, patch: TransactionPatch) {
    const set = toTransactionSet(patch);
    const exists =
      Object.keys(set).length === 0
        ? this.db
            .select({ id: t.transactions.id })
            .from(t.transactions)
            .where(eq(t.transactions.id, id))
            .all()
        : this.db
            .update(t.transactions)
            .set(set)
            .where(eq(t.transactions.id, id))
            .returning({ id: t.transactions.id })
            .all();
    if (exists.length === 0) throw new Error('Unknown transaction id');
  }

  async findByTxnRef(issuerId: string | null, txnRef: string) {
    return this.db
      .select()
      .from(t.transactions)
      .where(
        and(
          isNull(t.transactions.deletedAt),
          eq(t.transactions.txnRef, txnRef),
          issuerId === null
            ? isNull(t.transactions.issuerId)
            : eq(t.transactions.issuerId, issuerId),
        ),
      )
      .orderBy(asc(t.transactions.occurredAt), asc(t.transactions.id))
      .all()
      .map(toTransaction);
  }

  async findInWindow(query: { from: string; to: string; amountMinor?: number }) {
    return this.db
      .select()
      .from(t.transactions)
      .where(
        and(
          isNull(t.transactions.deletedAt),
          gte(t.transactions.occurredAt, query.from),
          lte(t.transactions.occurredAt, query.to),
          query.amountMinor === undefined
            ? undefined
            : eq(t.transactions.amountMinor, query.amountMinor),
        ),
      )
      .orderBy(asc(t.transactions.occurredAt), asc(t.transactions.id))
      .all()
      .map(toTransaction);
  }

  async listByMerchant(merchantName: string, limit = 50) {
    return this.db
      .select()
      .from(t.transactions)
      .where(and(isNull(t.transactions.deletedAt), eq(t.transactions.merchantName, merchantName)))
      .orderBy(desc(t.transactions.occurredAt), asc(t.transactions.id))
      .limit(limit)
      .all()
      .map(toTransaction);
  }

  async listBetween(from: string, to: string) {
    return this.db
      .select()
      .from(t.transactions)
      .where(
        and(
          isNull(t.transactions.deletedAt),
          gte(t.transactions.occurredAt, from),
          lt(t.transactions.occurredAt, to),
        ),
      )
      .orderBy(asc(t.transactions.occurredAt), asc(t.transactions.id))
      .all()
      .map(toTransaction);
  }
}

export class SqliteInboxRepo implements InboxRepo {
  constructor(private readonly db: SteadilyDb) {}

  async get(id: string) {
    const row = this.db.select().from(t.inbox).where(eq(t.inbox.id, id)).get();
    return row ? toInboxItem(row) : null;
  }

  async delete(id: string) {
    this.db.delete(t.inbox).where(eq(t.inbox.id, id)).run();
  }

  async purgeExpired(now: string) {
    return this.db
      .delete(t.inbox)
      .where(lte(t.inbox.expiresAt, now))
      .returning({ id: t.inbox.id })
      .all().length;
  }
}

export class SqliteUserRuleRepo implements UserRuleRepo {
  constructor(private readonly db: SteadilyDb) {}

  async findForMerchant(merchantKey: string) {
    const exact = this.db
      .select()
      .from(t.userRules)
      .where(
        and(
          isNull(t.userRules.deletedAt),
          eq(t.userRules.matchType, 'merchant_exact'),
          eq(t.userRules.pattern, merchantKey),
        ),
      )
      .orderBy(asc(t.userRules.createdAt), asc(t.userRules.id))
      .get();
    if (exact) return toUserRule(exact);

    // instr() is a case-sensitive substring test, like String#includes.
    const contains = this.db
      .select()
      .from(t.userRules)
      .where(
        and(
          isNull(t.userRules.deletedAt),
          eq(t.userRules.matchType, 'merchant_contains'),
          sql`instr(${merchantKey}, ${t.userRules.pattern}) > 0`,
        ),
      )
      .orderBy(
        desc(sql`length(${t.userRules.pattern})`),
        asc(t.userRules.createdAt),
        asc(t.userRules.id),
      )
      .get();
    return contains ? toUserRule(contains) : null;
  }

  async upsert(rule: UserRule) {
    const values = {
      id: rule.id,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
      deletedAt: rule.deletedAt,
      matchType: rule.matchType,
      pattern: rule.pattern,
      categoryId: rule.categoryId,
      kind: rule.kind,
      hits: rule.hits,
    };
    const { id: _id, ...update } = values;
    this.db
      .insert(t.userRules)
      .values(values)
      .onConflictDoUpdate({ target: t.userRules.id, set: update })
      .run();
  }

  async incrementHits(id: string, at: string) {
    this.db
      .update(t.userRules)
      .set({ hits: sql`${t.userRules.hits} + 1`, updatedAt: at })
      .where(eq(t.userRules.id, id))
      .run();
  }
}

export class SqliteBudgetRepo implements BudgetRepo {
  constructor(private readonly db: SteadilyDb) {}

  async listActive() {
    return this.db
      .select()
      .from(t.budgets)
      .where(isNull(t.budgets.deletedAt))
      .orderBy(asc(t.budgets.createdAt), asc(t.budgets.id))
      .all()
      .map(toBudget);
  }
}

export class SqliteSubscriptionRepo implements SubscriptionRepo {
  constructor(private readonly db: SteadilyDb) {}

  async listActive() {
    return this.db
      .select()
      .from(t.subscriptions)
      .where(and(isNull(t.subscriptions.deletedAt), eq(t.subscriptions.dismissed, false)))
      .orderBy(asc(t.subscriptions.createdAt), asc(t.subscriptions.id))
      .all()
      .map(toSubscription);
  }

  async findByMerchant(merchantName: string, cadence: Subscription['cadence']) {
    const row = this.db
      .select()
      .from(t.subscriptions)
      .where(
        and(
          isNull(t.subscriptions.deletedAt),
          eq(t.subscriptions.merchantName, merchantName),
          eq(t.subscriptions.cadence, cadence),
        ),
      )
      .get();
    return row ? toSubscription(row) : null;
  }

  async upsert(subscription: Subscription) {
    const values = {
      id: subscription.id,
      createdAt: subscription.createdAt,
      updatedAt: subscription.updatedAt,
      deletedAt: subscription.deletedAt,
      merchantName: subscription.merchantName,
      cadence: subscription.cadence,
      amountMinor: subscription.amountMinor,
      currency: subscription.currency,
      categoryId: subscription.categoryId,
      lastChargedAt: subscription.lastChargedAt,
      nextDueAt: subscription.nextDueAt,
      dismissed: subscription.dismissed,
    };
    const { id: _id, ...update } = values;
    this.db
      .insert(t.subscriptions)
      .values(values)
      .onConflictDoUpdate({ target: t.subscriptions.id, set: update })
      .run();
  }
}

type SettingKey = keyof Settings;
const SETTING_KEYS = Object.keys(Settings.shape) as SettingKey[];

export class SqliteSettingsRepo implements SettingsRepo {
  constructor(private readonly db: SteadilyDb) {}

  /**
   * Stored keys merged over DEFAULT_SETTINGS. A stored value that fails its
   * zod schema (e.g. written by an older app version) falls back to the
   * default for that key; unknown keys are ignored.
   */
  async get(): Promise<Settings> {
    const stored = new Map<string, unknown>(
      this.db
        .select({ key: t.settings.key, value: t.settings.value })
        .from(t.settings)
        .all()
        .map((row) => [row.key, row.value]),
    );
    const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const key of SETTING_KEYS) {
      if (!stored.has(key)) continue;
      const parsed = Settings.shape[key].safeParse(stored.get(key));
      if (parsed.success) merged[key] = parsed.data;
    }
    return Settings.parse(merged);
  }
}

/** Builds every data port over one database. */
export function createRepos(db: SteadilyDb): Repos & {
  transactions: SqliteTransactionRepo;
  inbox: SqliteInboxRepo;
  userRules: SqliteUserRuleRepo;
  budgets: SqliteBudgetRepo;
  subscriptions: SqliteSubscriptionRepo;
  settings: SqliteSettingsRepo;
} {
  return {
    transactions: new SqliteTransactionRepo(db),
    inbox: new SqliteInboxRepo(db),
    userRules: new SqliteUserRuleRepo(db),
    budgets: new SqliteBudgetRepo(db),
    subscriptions: new SqliteSubscriptionRepo(db),
    settings: new SqliteSettingsRepo(db),
  };
}

// ---------------------------------------------------------------------------
// Write helpers outside the agent ports (capture code, settings screen, tests)
// ---------------------------------------------------------------------------

/** Stores a raw capture until the Parser consumes it. Never log `rawText` (D-011). */
export function insertInboxItem(db: SteadilyDb, item: InboxItem): void {
  db.insert(t.inbox)
    .values({
      id: item.id,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
      source: item.source,
      rawText: item.rawText,
      originApp: item.originApp,
      originSender: item.originSender,
    })
    .run();
}

/** Validates and stores settings keys; keys not in `patch` are left unchanged. */
export function saveSettings(db: SteadilyDb, patch: Partial<Settings>, at: string): void {
  const valid = Settings.partial().strict().parse(patch);
  db.transaction((tx) => {
    for (const key of SETTING_KEYS) {
      if (!(key in valid)) continue;
      // Raw JSON text: drizzle's json mode would write a null value (quietHours) as SQL NULL.
      const value = sql`${JSON.stringify(valid[key])}`;
      tx.insert(t.settings)
        .values({ key, value, updatedAt: at })
        .onConflictDoUpdate({ target: t.settings.key, set: { value, updatedAt: at } })
        .run();
    }
  });
}
