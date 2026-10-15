/**
 * Data ports the runtime agents depend on (contract owned by the Orchestrator).
 *
 * Agents receive these through their factory functions, never a raw database.
 * `packages/db` provides the SQLite implementations; `InMemory*` versions below
 * are for tests. All timestamps are ISO strings; money is integer minor units.
 */
import type { CaptureSource, Settings, Transaction, TransactionKind } from '@steadily/shared-types';
import { DEFAULT_SETTINGS } from '@steadily/shared-types';
import type { CategoryId } from '@steadily/taxonomy';

export type InboxItem = {
  id: string;
  createdAt: string;
  expiresAt: string;
  source: CaptureSource;
  /** Raw alert / OCR text. Never logged, never put on an event (D-011). */
  rawText: string;
  /** Android package that posted the notification, if any. */
  originApp: string | null;
  /** SMS sender id / short code, if any. */
  originSender: string | null;
};

export type UserRule = {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  matchType: 'merchant_exact' | 'merchant_contains';
  /** Lowercase merchant key, see @steadily/merchants `toMerchantKey`. */
  pattern: string;
  categoryId: CategoryId;
  kind: TransactionKind | null;
  hits: number;
};

export type Budget = {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** null = overall monthly budget. */
  categoryId: CategoryId | null;
  period: 'monthly';
  amountMinor: number;
  currency: string;
  rollover: boolean;
};

export type Subscription = {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  merchantName: string;
  cadence: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  amountMinor: number;
  currency: string;
  categoryId: CategoryId;
  lastChargedAt: string;
  nextDueAt: string | null;
  dismissed: boolean;
};

export type TransactionPatch = Partial<Omit<Transaction, 'id' | 'createdAt'>>;

export interface TransactionRepo {
  get(id: string): Promise<Transaction | null>;
  insert(tx: Transaction): Promise<void>;
  update(id: string, patch: TransactionPatch): Promise<void>;
  /** Non-deleted transactions with this issuer reference. */
  findByTxnRef(issuerId: string | null, txnRef: string): Promise<Transaction[]>;
  /** Non-deleted transactions with occurredAt in [from, to], optionally matching amount. */
  findInWindow(query: { from: string; to: string; amountMinor?: number }): Promise<Transaction[]>;
  /** Most recent first. */
  listByMerchant(merchantName: string, limit?: number): Promise<Transaction[]>;
  /** Non-deleted, occurredAt in [from, to), oldest first. */
  listBetween(from: string, to: string): Promise<Transaction[]>;
}

export interface InboxRepo {
  get(id: string): Promise<InboxItem | null>;
  delete(id: string): Promise<void>;
  /** Deletes items with expiresAt <= now; returns how many were removed. */
  purgeExpired(now: string): Promise<number>;
}

export interface UserRuleRepo {
  /** Best rule for a merchant key: exact match first, then longest `contains` pattern. */
  findForMerchant(merchantKey: string): Promise<UserRule | null>;
  upsert(rule: UserRule): Promise<void>;
  incrementHits(id: string, at: string): Promise<void>;
}

export interface BudgetRepo {
  listActive(): Promise<Budget[]>;
}

export interface SubscriptionRepo {
  listActive(): Promise<Subscription[]>;
  findByMerchant(
    merchantName: string,
    cadence: Subscription['cadence'],
  ): Promise<Subscription | null>;
  upsert(subscription: Subscription): Promise<void>;
}

export interface SettingsRepo {
  get(): Promise<Settings>;
}

export type Repos = {
  transactions: TransactionRepo;
  inbox: InboxRepo;
  userRules: UserRuleRepo;
  budgets: BudgetRepo;
  subscriptions: SubscriptionRepo;
  settings: SettingsRepo;
};

// ---------------------------------------------------------------------------
// In-memory implementations for tests.
// ---------------------------------------------------------------------------

const alive = <T extends { deletedAt: string | null }>(row: T) => row.deletedAt === null;

export class InMemoryTransactionRepo implements TransactionRepo {
  readonly rows = new Map<string, Transaction>();

  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
  async insert(tx: Transaction) {
    if (this.rows.has(tx.id)) throw new Error('Duplicate transaction id');
    this.rows.set(tx.id, { ...tx });
  }
  async update(id: string, patch: TransactionPatch) {
    const row = this.rows.get(id);
    if (!row) throw new Error('Unknown transaction id');
    this.rows.set(id, { ...row, ...patch });
  }
  async findByTxnRef(issuerId: string | null, txnRef: string) {
    return [...this.rows.values()].filter(
      (t) => alive(t) && t.txnRef === txnRef && t.issuerId === issuerId,
    );
  }
  async findInWindow(query: { from: string; to: string; amountMinor?: number }) {
    return [...this.rows.values()].filter(
      (t) =>
        alive(t) &&
        t.occurredAt >= query.from &&
        t.occurredAt <= query.to &&
        (query.amountMinor === undefined || t.amountMinor === query.amountMinor),
    );
  }
  async listByMerchant(merchantName: string, limit = 50) {
    return [...this.rows.values()]
      .filter((t) => alive(t) && t.merchantName === merchantName)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, limit);
  }
  async listBetween(from: string, to: string) {
    return [...this.rows.values()]
      .filter((t) => alive(t) && t.occurredAt >= from && t.occurredAt < to)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }
}

export class InMemoryInboxRepo implements InboxRepo {
  readonly rows = new Map<string, InboxItem>();

  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
  async delete(id: string) {
    this.rows.delete(id);
  }
  async purgeExpired(now: string) {
    let removed = 0;
    for (const [id, item] of this.rows) {
      if (item.expiresAt <= now) {
        this.rows.delete(id);
        removed++;
      }
    }
    return removed;
  }
}

export class InMemoryUserRuleRepo implements UserRuleRepo {
  readonly rows = new Map<string, UserRule>();

  async findForMerchant(merchantKey: string) {
    const rules = [...this.rows.values()].filter(alive);
    const exact = rules.find((r) => r.matchType === 'merchant_exact' && r.pattern === merchantKey);
    if (exact) return exact;
    return (
      rules
        .filter((r) => r.matchType === 'merchant_contains' && merchantKey.includes(r.pattern))
        .sort((a, b) => b.pattern.length - a.pattern.length)[0] ?? null
    );
  }
  async upsert(rule: UserRule) {
    this.rows.set(rule.id, { ...rule });
  }
  async incrementHits(id: string, at: string) {
    const rule = this.rows.get(id);
    if (rule) this.rows.set(id, { ...rule, hits: rule.hits + 1, updatedAt: at });
  }
}

export class InMemoryBudgetRepo implements BudgetRepo {
  readonly rows = new Map<string, Budget>();

  async listActive() {
    return [...this.rows.values()].filter(alive);
  }
}

export class InMemorySubscriptionRepo implements SubscriptionRepo {
  readonly rows = new Map<string, Subscription>();

  async listActive() {
    return [...this.rows.values()].filter((s) => alive(s) && !s.dismissed);
  }
  async findByMerchant(merchantName: string, cadence: Subscription['cadence']) {
    return (
      [...this.rows.values()].find(
        (s) => alive(s) && s.merchantName === merchantName && s.cadence === cadence,
      ) ?? null
    );
  }
  async upsert(subscription: Subscription) {
    this.rows.set(subscription.id, { ...subscription });
  }
}

export class InMemorySettingsRepo implements SettingsRepo {
  constructor(public value: Settings = DEFAULT_SETTINGS) {}

  async get() {
    return this.value;
  }
}

export function createInMemoryRepos(): Repos & {
  transactions: InMemoryTransactionRepo;
  inbox: InMemoryInboxRepo;
  userRules: InMemoryUserRuleRepo;
  budgets: InMemoryBudgetRepo;
  subscriptions: InMemorySubscriptionRepo;
  settings: InMemorySettingsRepo;
} {
  return {
    transactions: new InMemoryTransactionRepo(),
    inbox: new InMemoryInboxRepo(),
    userRules: new InMemoryUserRuleRepo(),
    budgets: new InMemoryBudgetRepo(),
    subscriptions: new InMemorySubscriptionRepo(),
    settings: new InMemorySettingsRepo(),
  };
}
