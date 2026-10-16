/**
 * `DataSource` over the on-device database (packages/db repositories) and the agent runtime
 * (D-017). Reads go straight to SQLite. Writes that agents must react to go through the event
 * bus; after every write the runtime runs until idle and screens are told to reload.
 *
 * Platform-free: the app builds it over expo-sqlite (`appDataSource.ts`), tests over
 * better-sqlite3 (`@steadily/db/node`).
 */
import {
  DEFAULT_SUGGESTIONS,
  monthPeriod,
  P2P_ISSUER_IDS,
  P2P_SUGGESTIONS,
  spendingTotals,
  spentForBudget,
  type IdGenerator,
  type UserRule,
} from '@steadily/agent-core';
import {
  budgets as budgetsTable,
  events,
  INBOX_TTL_MS,
  insertInboxItem,
  issuers as issuersTable,
  saveSettings,
  transactions as transactionsTable,
  type SteadilyDb,
} from '@steadily/db';
import { lookupMerchant, toMerchantKey } from '@steadily/merchants';
import {
  CaptureSource,
  EventPayloads,
  type EventPayload,
  type NewEvent,
} from '@steadily/shared-types';
import {
  CATEGORIES,
  FALLBACK_CATEGORY_ID,
  isBuiltInCategoryId,
  type BuiltInCategoryId,
} from '@steadily/taxonomy';
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import { APP_KEYS, readAppValue, writeAppValue } from './appSettings';
import type { DataSource } from './DataSource';
import { ISSUER_IDS, isIssuerId, type IssuerId } from './issuers';
import type { AppRuntime } from './runtime';
import type {
  Budget,
  BudgetInput,
  BudgetWithSpent,
  IssuerSetup,
  IssuerSetupStatus,
  OnboardingProgress,
  OnboardingStep,
  ReviewItem,
  SubscriptionSummary,
  Transaction,
} from './types';

/** Captures that come from a bank or payment alert (as opposed to shares or imports). */
const ALERT_SOURCES: CaptureSource[] = [
  'android_notification',
  'ios_sms_shortcut',
  'ios_apple_pay_shortcut',
];

const MAX_CHIPS = 3;
const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  'welcome',
  'issuers',
  'setup',
  'connect',
  'battery',
  'waiting',
];
const DEFAULT_ONBOARDING: OnboardingProgress = { completed: false, step: 'welcome' };
const SETUP_STATUSES: readonly IssuerSetupStatus[] = ['pending', 'done', 'skipped'];
const categoryOrder = new Map<string, number>(CATEGORIES.map((c, i) => [c.id, i]));

/** One alert to run through the pipeline, as the native capture surfaces would store it. */
export type AlertCapture = {
  text: string;
  source: CaptureSource;
  androidPackage?: string;
  smsSender?: string;
  /** Overrides the parsed date (the native fast path may pass it); ISO. */
  occurredAt?: string;
};

export interface RepoDataSource extends DataSource {
  /** Runs agent ticks and pending events (e.g. captures from native surfaces), then reloads. */
  refresh(): Promise<void>;
  /** Stores raw alerts in the inbox and runs them through the full agent pipeline. */
  captureAlerts(alerts: readonly AlertCapture[]): Promise<void>;
}

export type RepoDataSourceOptions = AppRuntime & {
  db: SteadilyDb;
  newId: IdGenerator;
  now?: () => Date;
  /** Development only: synthetic alerts for the "Seed sample data" action in Settings. */
  sampleAlerts?: () => readonly AlertCapture[];
};

export function createRepoDataSource(options: RepoDataSourceOptions): RepoDataSource {
  const { db, runtime, repos, newId } = options;
  const clock = options.now ?? (() => new Date());
  const nowIso = () => clock().toISOString();

  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  /** Lets the agents finish, records alert arrivals, then tells screens. */
  async function settle(): Promise<void> {
    await runtime.runUntilIdle();
    syncIssuerAlerts();
    notify();
  }

  async function requireTx(id: string): Promise<Transaction> {
    const tx = await repos.transactions.get(id);
    if (!tx || tx.deletedAt !== null) throw new Error('Unknown transaction');
    return tx;
  }

  // -------------------------------------------------------------------------
  // Issuers and onboarding
  // -------------------------------------------------------------------------

  function readSetupStatuses(): Partial<Record<IssuerId, IssuerSetupStatus>> {
    const value = readAppValue(db, APP_KEYS.issuerSetup);
    const out: Partial<Record<IssuerId, IssuerSetupStatus>> = {};
    if (value && typeof value === 'object') {
      for (const [id, status] of Object.entries(value)) {
        if (isIssuerId(id) && SETUP_STATUSES.includes(status as IssuerSetupStatus)) {
          out[id] = status as IssuerSetupStatus;
        }
      }
    }
    return out;
  }

  function readOnboarding(): OnboardingProgress {
    const value = readAppValue(db, APP_KEYS.onboarding);
    if (!value || typeof value !== 'object') return { ...DEFAULT_ONBOARDING };
    const { completed, step } = value as Partial<OnboardingProgress>;
    return {
      completed: typeof completed === 'boolean' ? completed : DEFAULT_ONBOARDING.completed,
      step: step && ONBOARDING_STEPS.includes(step) ? step : DEFAULT_ONBOARDING.step,
    };
  }

  /** Writes the issuer row's `enabled` flag, keeping `lastAlertAt`. */
  function upsertIssuer(issuerId: string, values: { enabled?: boolean; lastAlertAt?: string }) {
    const at = nowIso();
    db.insert(issuersTable)
      .values({
        issuerId,
        createdAt: at,
        updatedAt: at,
        enabled: values.enabled ?? false,
        lastAlertAt: values.lastAlertAt ?? null,
      })
      .onConflictDoUpdate({ target: issuersTable.issuerId, set: { ...values, updatedAt: at } })
      .run();
  }

  /** Moves `issuers.lastAlertAt` forward to the newest alert-sourced capture per issuer. */
  function syncIssuerAlerts(): void {
    const latest = db
      .select({
        issuerId: transactionsTable.issuerId,
        last: sql<string>`max(${transactionsTable.createdAt})`,
      })
      .from(transactionsTable)
      .where(
        and(
          isNull(transactionsTable.deletedAt),
          isNotNull(transactionsTable.issuerId),
          inArray(transactionsTable.source, ALERT_SOURCES),
        ),
      )
      .groupBy(transactionsTable.issuerId)
      .all();
    if (latest.length === 0) return;
    const stored = new Map(
      db
        .select({ issuerId: issuersTable.issuerId, lastAlertAt: issuersTable.lastAlertAt })
        .from(issuersTable)
        .all()
        .map((row) => [row.issuerId, row.lastAlertAt]),
    );
    db.transaction(() => {
      for (const { issuerId, last } of latest) {
        if (issuerId === null) continue;
        const previous = stored.get(issuerId);
        if (previous && previous >= last) continue;
        upsertIssuer(issuerId, { lastAlertAt: last });
      }
    });
  }

  // -------------------------------------------------------------------------
  // Review chips and subscription prices, from the event log
  // -------------------------------------------------------------------------

  const payloadField = (path: string) => sql`json_extract(${events.payload}, ${path})`;

  /** Latest `transaction.categorized` payload per transaction. */
  function latestCategorized(
    ids: readonly string[],
  ): Map<string, EventPayload<'transaction.categorized'>> {
    const out = new Map<string, EventPayload<'transaction.categorized'>>();
    if (ids.length === 0) return out;
    const rows = db
      .select({ payload: events.payload })
      .from(events)
      .where(
        and(
          eq(events.type, 'transaction.categorized'),
          inArray(payloadField('$.transactionId'), [...ids]),
        ),
      )
      .orderBy(asc(events.seq))
      .all();
    for (const row of rows) {
      const parsed = EventPayloads['transaction.categorized'].safeParse(row.payload);
      if (parsed.success) out.set(parsed.data.transactionId, parsed.data);
    }
    return out;
  }

  /** Current category first (it is still a guess), then the categorizer's suggestions. */
  function chipsFor(
    tx: Transaction,
    categorized: EventPayload<'transaction.categorized'> | undefined,
  ): BuiltInCategoryId[] {
    const fallback = tx.issuerId && P2P_ISSUER_IDS.has(tx.issuerId)
      ? P2P_SUGGESTIONS
      : DEFAULT_SUGGESTIONS;
    const suggested = categorized?.suggestions?.map((s) => s.categoryId) ?? fallback;
    const chips: BuiltInCategoryId[] = [];
    for (const id of [tx.categoryId, ...suggested]) {
      if (chips.length >= MAX_CHIPS) break;
      if (isBuiltInCategoryId(id) && !chips.includes(id)) chips.push(id);
    }
    return chips;
  }

  /** Latest `subscription.price_changed` payload per subscription. */
  function latestPriceChanges(): Map<string, EventPayload<'subscription.price_changed'>> {
    const out = new Map<string, EventPayload<'subscription.price_changed'>>();
    const rows = db
      .select({ payload: events.payload })
      .from(events)
      .where(eq(events.type, 'subscription.price_changed'))
      .orderBy(asc(events.seq))
      .all();
    for (const row of rows) {
      const parsed = EventPayloads['subscription.price_changed'].safeParse(row.payload);
      if (parsed.success) out.set(parsed.data.subscriptionId, parsed.data);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Rules
  // -------------------------------------------------------------------------

  /** A payment to or from a person on a P2P app. Their names never become rules. */
  function isPerson(tx: Transaction, key: string): boolean {
    return tx.issuerId !== null && P2P_ISSUER_IDS.has(tx.issuerId) && !lookupMerchant(key);
  }

  /** The exact-match rule for a merchant key, if there is one. */
  async function exactRule(key: string): Promise<UserRule | null> {
    const rule = await repos.userRules.findForMerchant(key);
    return rule && rule.matchType === 'merchant_exact' && rule.pattern === key ? rule : null;
  }

  async function capture(alerts: readonly AlertCapture[]): Promise<void> {
    const createdAt = clock();
    const expiresAt = new Date(createdAt.getTime() + INBOX_TTL_MS).toISOString();
    const captured: NewEvent[] = [];
    for (const alert of alerts) {
      const inboxId = newId();
      // Raw text goes to the inbox only; the event carries ids and extracted fields (D-011).
      insertInboxItem(db, {
        id: inboxId,
        createdAt: createdAt.toISOString(),
        expiresAt,
        source: alert.source,
        rawText: alert.text,
        originApp: alert.androidPackage ?? null,
        originSender: alert.smsSender ?? null,
      });
      captured.push({
        type: 'transaction.captured',
        payload: {
          inboxId,
          source: alert.source,
          extracted: alert.occurredAt ? { occurredAt: alert.occurredAt } : {},
        },
      });
    }
    await runtime.bus.publish(captured, null);
    await settle();
  }

  const source: RepoDataSource = {
    now: clock,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async refresh() {
      await runtime.tick();
      syncIssuerAlerts();
      notify();
    },

    captureAlerts: capture,

    // -- Transactions -------------------------------------------------------

    async listTransactions(range) {
      const rows = await repos.transactions.listBetween(range.from, range.to);
      return rows.reverse();
    },

    async getTransaction(id) {
      const tx = await repos.transactions.get(id);
      return tx && tx.deletedAt === null ? tx : null;
    },

    async listNeedsReview(): Promise<ReviewItem[]> {
      const rows = db
        .select({ id: transactionsTable.id })
        .from(transactionsTable)
        .where(
          and(isNull(transactionsTable.deletedAt), eq(transactionsTable.status, 'needs_review')),
        )
        .orderBy(asc(transactionsTable.occurredAt), asc(transactionsTable.id))
        .all();
      const txs: Transaction[] = [];
      for (const { id } of rows) {
        const tx = await repos.transactions.get(id);
        if (tx) txs.push(tx);
      }
      const categorized = latestCategorized(txs.map((t) => t.id));
      return txs.map((transaction) => ({
        transaction,
        suggestedCategoryIds: chipsFor(transaction, categorized.get(transaction.id)),
      }));
    },

    async confirmCategory(id, categoryId, applyToSimilar) {
      const tx = await requireTx(id);
      if (tx.kind === 'transfer') {
        // Picking a spending category for something marked "not an expense" makes it one again,
        // and the merchant's "not an expense" rule no longer holds.
        const at = nowIso();
        await repos.transactions.update(id, { kind: 'expense', updatedAt: at });
        const rule = tx.merchantName ? await exactRule(toMerchantKey(tx.merchantName)) : null;
        if (rule?.kind === 'transfer') {
          await repos.userRules.upsert({ ...rule, kind: null, updatedAt: at });
        }
      }
      // The Categorizer applies the correction and learns the rule; the Budget Coach re-checks.
      await runtime.bus.publish(
        [
          {
            type: 'transaction.user_corrected',
            payload: {
              transactionId: id,
              previousCategoryId: tx.categoryId,
              categoryId,
              applyToSimilar,
            },
          },
        ],
        null,
      );
      await settle();
    },

    async markNotExpense(id) {
      const tx = await requireTx(id);
      const at = nowIso();
      await repos.transactions.update(id, {
        kind: 'transfer',
        status: 'confirmed',
        categorySource: 'user',
        categoryConfidence: 1,
        updatedAt: at,
      });
      // Remember it for the merchant (e.g. a card payment), never for a person.
      const key = tx.merchantName ? toMerchantKey(tx.merchantName) : '';
      if (key && !isPerson(tx, key)) {
        const existing = await exactRule(key);
        await repos.userRules.upsert(
          existing
            ? { ...existing, kind: 'transfer', updatedAt: at }
            : {
                id: newId(),
                createdAt: at,
                updatedAt: at,
                deletedAt: null,
                matchType: 'merchant_exact',
                pattern: key,
                categoryId: FALLBACK_CATEGORY_ID,
                kind: 'transfer',
                hits: 0,
              },
        );
      }
      notify();
    },

    async setNote(id, note) {
      await requireTx(id);
      const trimmed = note?.trim() ?? '';
      await repos.transactions.update(id, {
        note: trimmed === '' ? null : trimmed.slice(0, 500),
        updatedAt: nowIso(),
      });
      notify();
    },

    // -- Budgets ------------------------------------------------------------

    async listBudgets(range): Promise<BudgetWithSpent[]> {
      const totals = spendingTotals(await repos.transactions.listBetween(range.from, range.to));
      const active = await repos.budgets.listActive();
      return active
        .sort((a, b) => {
          const ai = a.categoryId === null ? -1 : (categoryOrder.get(a.categoryId) ?? 99);
          const bi = b.categoryId === null ? -1 : (categoryOrder.get(b.categoryId) ?? 99);
          return ai - bi;
        })
        .map((budget) => ({ budget, spentMinor: spentForBudget(budget, totals) }));
    },

    async setBudget(input: BudgetInput): Promise<Budget> {
      if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
        throw new Error('Budget amount must be a positive number of cents');
      }
      const at = nowIso();
      const existing = (await repos.budgets.listActive()).find(
        (b) => b.categoryId === input.categoryId,
      );
      if (existing) {
        db.update(budgetsTable)
          .set({ amountMinor: input.amountMinor, updatedAt: at })
          .where(eq(budgetsTable.id, existing.id))
          .run();
        notify();
        return { ...existing, amountMinor: input.amountMinor, updatedAt: at };
      }
      const budget: Budget = {
        id: newId(),
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
        categoryId: input.categoryId,
        period: 'monthly',
        amountMinor: input.amountMinor,
        currency: 'USD',
        rollover: false,
      };
      db.insert(budgetsTable).values(budget).run();
      notify();
      return budget;
    },

    async deleteBudget(id) {
      const at = nowIso();
      db.update(budgetsTable)
        .set({ deletedAt: at, updatedAt: at })
        .where(and(eq(budgetsTable.id, id), isNull(budgetsTable.deletedAt)))
        .run();
      notify();
    },

    // -- Subscriptions ------------------------------------------------------

    async listSubscriptions(): Promise<SubscriptionSummary[]> {
      const changes = latestPriceChanges();
      return (await repos.subscriptions.listActive()).map((subscription) => {
        const change = changes.get(subscription.id);
        // Only while the current price is the one the change announced.
        const previous =
          change && change.amountMinor === subscription.amountMinor
            ? change.previousAmountMinor
            : null;
        return { subscription, previousAmountMinor: previous };
      });
    },

    // -- Issuers and onboarding ---------------------------------------------

    async listIssuerSetup(): Promise<IssuerSetup[]> {
      const rows = new Map(
        db
          .select()
          .from(issuersTable)
          .all()
          .map((row) => [row.issuerId, row]),
      );
      const statuses = readSetupStatuses();
      return ISSUER_IDS.map((issuerId) => {
        const row = rows.get(issuerId);
        return {
          issuerId,
          selected: row?.enabled ?? false,
          setupStatus: statuses[issuerId] ?? 'pending',
          lastAlertAt: row?.lastAlertAt ?? null,
        };
      });
    },

    async setSelectedIssuers(ids) {
      const picked = new Set(ids);
      const before = await source.listIssuerSetup();
      const statuses: Partial<Record<IssuerId, IssuerSetupStatus>> = {};
      db.transaction(() => {
        for (const state of before) {
          const selected = picked.has(state.issuerId);
          // Dropping an issuer forgets its progress; picking it again starts over.
          statuses[state.issuerId] = selected && state.selected ? state.setupStatus : 'pending';
          upsertIssuer(state.issuerId, { enabled: selected });
        }
        writeAppValue(db, APP_KEYS.issuerSetup, statuses, nowIso());
      });
      notify();
    },

    async setIssuerSetupStatus(id, status) {
      const exists = db
        .select({ issuerId: issuersTable.issuerId })
        .from(issuersTable)
        .where(eq(issuersTable.issuerId, id))
        .get();
      db.transaction(() => {
        if (!exists) upsertIssuer(id, { enabled: true });
        writeAppValue(db, APP_KEYS.issuerSetup, { ...readSetupStatuses(), [id]: status }, nowIso());
      });
      notify();
    },

    async getOnboarding() {
      return readOnboarding();
    },

    async saveOnboarding(patch) {
      const next = { ...readOnboarding(), ...patch };
      writeAppValue(db, APP_KEYS.onboarding, next, nowIso());
      notify();
      return next;
    },

    // -- Settings -----------------------------------------------------------

    async getSettings() {
      return repos.settings.get();
    },

    async updateSettings(patch) {
      saveSettings(db, patch, nowIso());
      notify();
      return repos.settings.get();
    },
  };

  const { sampleAlerts } = options;
  if (sampleAlerts) {
    source.seedSampleData = async () => {
      const alerts = sampleAlerts();
      await capture(alerts);
      return alerts.length;
    };
  }
  return source;
}

/**
 * Spreads alerts over the current local month up to `now`, oldest first, so seeded data lands
 * in this month's budgets.
 */
export function spreadOverMonth<T extends { occurredAt?: string }>(
  alerts: readonly T[],
  now: Date,
): T[] {
  const start = Date.parse(monthPeriod(now).start);
  const span = now.getTime() - start;
  return alerts.map((alert, i) => ({
    ...alert,
    occurredAt: new Date(start + Math.floor((span * (i + 1)) / (alerts.length + 1))).toISOString(),
  }));
}
