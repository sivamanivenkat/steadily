/**
 * Local SQLite schema (SQLCipher-encrypted on device, D-011).
 *
 * Sync-ready from day one: synced tables use uuid ids, updated_at and a
 * deleted_at tombstone, so E2E-encrypted sync can be added later (D-016, D-021)
 * without rewriting rows.
 *
 * This file is a contract owned by the Orchestrator.
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type {
  CaptureSource,
  CategorySource,
  TransactionKind,
  TransactionStatus,
} from '@steadily/shared-types';
import type { CategoryId } from '@steadily/taxonomy';

const timestamps = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
};

export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    ...timestamps,
    occurredAt: text('occurred_at').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    kind: text('kind').$type<TransactionKind>().notNull(),
    merchantRaw: text('merchant_raw'),
    merchantName: text('merchant_name'),
    categoryId: text('category_id').$type<CategoryId>().notNull(),
    categoryConfidence: real('category_confidence').notNull(),
    categorySource: text('category_source').$type<CategorySource>().notNull(),
    status: text('status').$type<TransactionStatus>().notNull(),
    source: text('source').$type<CaptureSource>().notNull(),
    accountLast4: text('account_last4'),
    issuerId: text('issuer_id'),
    txnRef: text('txn_ref'),
    note: text('note'),
    linkedTransactionId: text('linked_transaction_id'),
  },
  (t) => [
    index('transactions_occurred_at_idx').on(t.occurredAt),
    index('transactions_category_idx').on(t.categoryId, t.occurredAt),
    index('transactions_merchant_idx').on(t.merchantName),
    index('transactions_status_idx').on(t.status),
    index('transactions_txn_ref_idx').on(t.issuerId, t.txnRef),
  ],
);

/** Append-only event bus (D-017). Payloads never contain raw alert text. */
export const events = sqliteTable(
  'events',
  {
    /** Monotonic order for delivery; id is the stable identity. */
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    id: text('id').notNull(),
    type: text('type').notNull(),
    at: text('at').notNull(),
    causationId: text('causation_id'),
    payload: text('payload', { mode: 'json' }).notNull(),
  },
  (t) => [uniqueIndex('events_id_idx').on(t.id), index('events_type_idx').on(t.type, t.seq)],
);

/** Idempotency: which events each agent has already handled. */
export const processedEvents = sqliteTable(
  'processed_events',
  {
    agent: text('agent').notNull(),
    eventId: text('event_id').notNull(),
    processedAt: text('processed_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.agent, t.eventId] })],
);

/**
 * Delivery failures per agent, so retry counts survive restarts and events an
 * agent gave up on are visible. Stores the error's name only, never its message
 * (messages can contain payload values, D-011).
 */
export const failedEvents = sqliteTable(
  'failed_events',
  {
    agent: text('agent').notNull(),
    eventId: text('event_id').notNull(),
    attempts: integer('attempts').notNull(),
    lastErrorName: text('last_error_name').notNull(),
    gaveUp: integer('gave_up', { mode: 'boolean' }).notNull().default(false),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.agent, t.eventId] })],
);

/** Last event seq the runtime has fully delivered, to avoid rescanning from 0. */
export const runtimeCursors = sqliteTable('runtime_cursors', {
  name: text('name').primaryKey(),
  seq: integer('seq').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * Short-lived raw captures (alert text, OCR text) awaiting parsing.
 * Rows are deleted as soon as the Parser finishes, and expired rows are purged.
 */
export const inbox = sqliteTable(
  'inbox',
  {
    id: text('id').primaryKey(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    source: text('source').$type<CaptureSource>().notNull(),
    rawText: text('raw_text').notNull(),
  },
  (t) => [index('inbox_expires_at_idx').on(t.expiresAt)],
);

/** Rules learned from user corrections or created by hand (D-010). */
export const userRules = sqliteTable(
  'user_rules',
  {
    id: text('id').primaryKey(),
    ...timestamps,
    matchType: text('match_type').$type<'merchant_exact' | 'merchant_contains'>().notNull(),
    /** Normalized (lowercase) merchant pattern. */
    pattern: text('pattern').notNull(),
    categoryId: text('category_id').$type<CategoryId>().notNull(),
    kind: text('kind').$type<TransactionKind>(),
    hits: integer('hits').notNull().default(0),
  },
  (t) => [index('user_rules_pattern_idx').on(t.matchType, t.pattern)],
);

/** User customizations of built-in categories, plus custom categories. */
export const categoryPrefs = sqliteTable('category_prefs', {
  categoryId: text('category_id').$type<CategoryId>().primaryKey(),
  ...timestamps,
  displayName: text('display_name'),
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order'),
  isCustom: integer('is_custom', { mode: 'boolean' }).notNull().default(false),
  /** Palette key from the design system, for custom categories. */
  colorKey: text('color_key'),
});

export const budgets = sqliteTable(
  'budgets',
  {
    id: text('id').primaryKey(),
    ...timestamps,
    /** null = overall monthly budget. */
    categoryId: text('category_id').$type<CategoryId>(),
    period: text('period').$type<'monthly'>().notNull().default('monthly'),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    rollover: integer('rollover', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [index('budgets_category_idx').on(t.categoryId)],
);

export const subscriptions = sqliteTable(
  'subscriptions',
  {
    id: text('id').primaryKey(),
    ...timestamps,
    merchantName: text('merchant_name').notNull(),
    cadence: text('cadence').$type<'weekly' | 'monthly' | 'quarterly' | 'yearly'>().notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    categoryId: text('category_id').$type<CategoryId>().notNull(),
    lastChargedAt: text('last_charged_at').notNull(),
    nextDueAt: text('next_due_at'),
    dismissed: integer('dismissed', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [uniqueIndex('subscriptions_merchant_cadence_idx').on(t.merchantName, t.cadence)],
);

/** Issuers the user set up in onboarding (D-014), stored on device only. */
export const issuers = sqliteTable('issuers', {
  issuerId: text('issuer_id').primaryKey(),
  ...timestamps,
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastAlertAt: text('last_alert_at'),
});

/** Key-value settings; values validated with the Settings zod schema. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
});
