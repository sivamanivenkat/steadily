import { spendingTotals, spentForBudget } from '@steadily/agent-core';
import { DEFAULT_SETTINGS } from '@steadily/shared-types';
import { CATEGORIES, type BuiltInCategoryId, type CategoryId } from '@steadily/taxonomy';

import { addDays, startOfDay } from '@/lib/dates';

import type { DataSource } from './DataSource';
import { ISSUER_IDS, type IssuerId } from './issuers';
import { defaultSeed, type SyntheticSeed } from './syntheticSeed';
import type {
  Budget,
  BudgetInput,
  BudgetWithSpent,
  DateRange,
  IssuerSetup,
  IssuerSetupStatus,
  OnboardingProgress,
  ReviewItem,
  Settings,
  Subscription,
  SubscriptionSummary,
  Transaction,
} from './types';

/** Sources that come from a bank or payment alert (as opposed to shares or imports). */
const ALERT_SOURCES = new Set<Transaction['source']>([
  'android_notification',
  'ios_sms_shortcut',
  'ios_apple_pay_shortcut',
]);

/** Deterministic uuid-shaped ids for synthetic rows. */
function synthId(prefix: number, n: number): string {
  return `00000000-0000-4000-8${prefix}00-${String(n).padStart(12, '0')}`;
}

const categoryOrder = new Map<string, number>(CATEGORIES.map((c, i) => [c.id, i]));

type Options = {
  /** Fixed clock. Defaults to the real time. */
  now?: () => Date;
  seed?: SyntheticSeed;
};

/**
 * In-memory `DataSource` over synthetic data. Nothing is written to disk; a cold start begins
 * from the seed again. Used by tests; the app uses the database-backed source.
 */
export function createSyntheticDataSource(options: Options = {}): DataSource {
  const clock = options.now ?? (() => new Date());
  const seed = options.seed ?? defaultSeed;
  const created = clock();
  const createdIso = created.toISOString();

  const transactions = new Map<string, Transaction>();
  const suggestions = new Map<string, BuiltInCategoryId[]>();
  /** Merchant name (lowercase) -> category the user chose ("remember for this merchant"). */
  const merchantRules = new Map<string, CategoryId>();
  const budgets = new Map<string, Budget>();
  const subscriptions = new Map<string, SubscriptionSummary>();
  const issuers = new Map<IssuerId, { selected: boolean; setupStatus: IssuerSetupStatus }>();
  let onboarding: OnboardingProgress = { completed: false, step: 'welcome', ...seed.onboarding };
  let settings: Settings = { ...DEFAULT_SETTINGS, ...seed.settings };
  let nextId = 1;

  seed.transactions.forEach((s, i) => {
    const day = addDays(startOfDay(created), -s.daysAgo);
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), s.at[0], s.at[1]);
    const id = synthId(1, i + 1);
    const needsReview = s.review !== undefined;
    transactions.set(id, {
      id,
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
      deletedAt: null,
      occurredAt: at.toISOString(),
      amountMinor: s.amountMinor,
      currency: 'USD',
      kind: s.kind ?? 'expense',
      merchantRaw: s.raw ?? null,
      merchantName: s.merchant,
      categoryId: s.category,
      categoryConfidence: needsReview ? 0.42 : 0.96,
      categorySource: needsReview ? 'classifier' : 'dictionary',
      status: needsReview ? 'needs_review' : 'confirmed',
      source: s.source ?? 'android_notification',
      accountLast4: s.last4 ?? null,
      issuerId: s.issuer ?? null,
      txnRef: null,
      note: s.note ?? null,
      linkedTransactionId: null,
    });
    if (s.review) suggestions.set(id, [...s.review].slice(0, 3));
  });

  seed.budgets.forEach((b) => {
    const id = synthId(2, nextId++);
    budgets.set(id, {
      id,
      createdAt: createdIso,
      updatedAt: createdIso,
      deletedAt: null,
      categoryId: b.category,
      period: 'monthly',
      amountMinor: b.amountMinor,
      currency: 'USD',
      rollover: false,
    });
  });

  seed.subscriptions.forEach((s) => {
    const id = synthId(3, nextId++);
    const last = addDays(startOfDay(created), -s.lastChargedDaysAgo);
    const next =
      s.cadence === 'monthly'
        ? new Date(last.getFullYear(), last.getMonth() + 1, last.getDate())
        : new Date(last.getFullYear() + 1, last.getMonth(), last.getDate());
    const subscription: Subscription = {
      id,
      createdAt: createdIso,
      updatedAt: createdIso,
      deletedAt: null,
      merchantName: s.merchant,
      cadence: s.cadence,
      amountMinor: s.amountMinor,
      currency: 'USD',
      categoryId: s.category,
      lastChargedAt: last.toISOString(),
      nextDueAt: next.toISOString(),
      dismissed: false,
    };
    subscriptions.set(id, { subscription, previousAmountMinor: s.previousAmountMinor ?? null });
  });

  for (const id of ISSUER_IDS) {
    issuers.set(id, seed.issuers?.[id] ?? { selected: false, setupStatus: 'pending' });
  }

  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  const nowIso = () => clock().toISOString();
  const alive = () => [...transactions.values()].filter((t) => t.deletedAt === null);
  const inRange = (range: DateRange) =>
    alive().filter((t) => t.occurredAt >= range.from && t.occurredAt < range.to);

  function requireTx(id: string): Transaction {
    const tx = transactions.get(id);
    if (!tx || tx.deletedAt !== null) throw new Error('Unknown transaction');
    return tx;
  }

  function update(id: string, patch: Partial<Transaction>) {
    transactions.set(id, { ...requireTx(id), ...patch, updatedAt: nowIso() });
  }

  const merchantKey = (tx: Transaction) => (tx.merchantName ?? tx.merchantRaw ?? '').toLowerCase();

  return {
    now: clock,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async listTransactions(range) {
      return inRange(range)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .map((t) => ({ ...t }));
    },

    async getTransaction(id) {
      const tx = transactions.get(id);
      return tx && tx.deletedAt === null ? { ...tx } : null;
    },

    async listNeedsReview(): Promise<ReviewItem[]> {
      return alive()
        .filter((t) => t.status === 'needs_review')
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
        .map((t) => ({
          transaction: { ...t },
          suggestedCategoryIds: suggestions.get(t.id) ?? [],
        }));
    },

    async confirmCategory(id, categoryId, applyToSimilar) {
      const tx = requireTx(id);
      const confirmed = {
        categoryId,
        categoryConfidence: 1,
        status: 'confirmed' as const,
        // Choosing a spending category for something marked "not an expense" makes it one again.
        kind: tx.kind === 'transfer' ? ('expense' as const) : tx.kind,
      };
      update(id, { ...confirmed, categorySource: 'user' });
      suggestions.delete(id);

      const key = merchantKey(tx);
      if (applyToSimilar && key) {
        merchantRules.set(key, categoryId);
        for (const other of alive()) {
          if (other.id !== id && other.status === 'needs_review' && merchantKey(other) === key) {
            update(other.id, { ...confirmed, categorySource: 'user_rule' });
            suggestions.delete(other.id);
          }
        }
      }
      notify();
    },

    async markNotExpense(id) {
      requireTx(id);
      update(id, { kind: 'transfer', status: 'confirmed', categorySource: 'user' });
      suggestions.delete(id);
      notify();
    },

    async setNote(id, note) {
      const trimmed = note?.trim() ?? '';
      update(id, { note: trimmed === '' ? null : trimmed.slice(0, 500) });
      notify();
    },

    async listBudgets(range): Promise<BudgetWithSpent[]> {
      const totals = spendingTotals(inRange(range));
      return [...budgets.values()]
        .filter((b) => b.deletedAt === null)
        .sort((a, b) => {
          const ai = a.categoryId === null ? -1 : (categoryOrder.get(a.categoryId) ?? 99);
          const bi = b.categoryId === null ? -1 : (categoryOrder.get(b.categoryId) ?? 99);
          return ai - bi;
        })
        .map((budget) => ({ budget: { ...budget }, spentMinor: spentForBudget(budget, totals) }));
    },

    async setBudget(input: BudgetInput) {
      if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
        throw new Error('Budget amount must be a positive number of cents');
      }
      const existing = [...budgets.values()].find(
        (b) => b.deletedAt === null && b.categoryId === input.categoryId,
      );
      const at = nowIso();
      const budget: Budget = existing
        ? { ...existing, amountMinor: input.amountMinor, updatedAt: at }
        : {
            id: synthId(2, nextId++),
            createdAt: at,
            updatedAt: at,
            deletedAt: null,
            categoryId: input.categoryId,
            period: 'monthly',
            amountMinor: input.amountMinor,
            currency: 'USD',
            rollover: false,
          };
      budgets.set(budget.id, budget);
      notify();
      return { ...budget };
    },

    async deleteBudget(id) {
      const budget = budgets.get(id);
      if (!budget) return;
      budgets.set(id, { ...budget, deletedAt: nowIso(), updatedAt: nowIso() });
      notify();
    },

    async listSubscriptions() {
      return [...subscriptions.values()]
        .filter((s) => s.subscription.deletedAt === null && !s.subscription.dismissed)
        .map((s) => ({ ...s, subscription: { ...s.subscription } }));
    },

    async listIssuerSetup(): Promise<IssuerSetup[]> {
      const lastAlert = new Map<string, string>();
      for (const tx of alive()) {
        if (tx.issuerId === null || !ALERT_SOURCES.has(tx.source)) continue;
        const prev = lastAlert.get(tx.issuerId);
        if (!prev || tx.occurredAt > prev) lastAlert.set(tx.issuerId, tx.occurredAt);
      }
      return ISSUER_IDS.map((issuerId) => {
        const state = issuers.get(issuerId) ?? { selected: false, setupStatus: 'pending' };
        return { issuerId, ...state, lastAlertAt: lastAlert.get(issuerId) ?? null };
      });
    },

    async setSelectedIssuers(ids) {
      const picked = new Set(ids);
      for (const id of ISSUER_IDS) {
        const state = issuers.get(id) ?? { selected: false, setupStatus: 'pending' };
        const selected = picked.has(id);
        issuers.set(id, {
          selected,
          // Dropping an issuer forgets its progress; picking it again starts over.
          setupStatus: selected && state.selected ? state.setupStatus : 'pending',
        });
      }
      notify();
    },

    async setIssuerSetupStatus(id, status) {
      const state = issuers.get(id) ?? { selected: true, setupStatus: 'pending' };
      issuers.set(id, { ...state, setupStatus: status });
      notify();
    },

    async getOnboarding() {
      return { ...onboarding };
    },

    async saveOnboarding(patch) {
      onboarding = { ...onboarding, ...patch };
      notify();
      return { ...onboarding };
    },

    async getSettings() {
      return { ...settings };
    },

    async updateSettings(patch) {
      settings = { ...settings, ...patch };
      notify();
      return { ...settings };
    },
  };
}
