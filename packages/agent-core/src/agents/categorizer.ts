import {
  AUTO_SAVE_CONFIDENCE,
  type Agent,
  type AgentContext,
  type CategorySource,
  type NewEvent,
  type StoredEvent,
  type Transaction,
  type TransactionKind,
} from '@steadily/shared-types';
import { lookupMerchant, toMerchantKey } from '@steadily/merchants';
import {
  BUILT_IN_CATEGORY_IDS,
  FALLBACK_CATEGORY_ID,
  isBuiltInCategoryId,
  type CategoryId,
} from '@steadily/taxonomy';
import { monthPeriod } from '../budget-math';
import { randomId, type IdGenerator } from '../event-bus';
import type { Repos, UserRule } from '../ports';
import { P2P_ISSUER_IDS } from './parser';

export const CATEGORIZER_AGENT_NAME = 'categorizer';

/**
 * Confidence per step (D-010). AUTO_SAVE_CONFIDENCE (0.85) is the auto-save line.
 *
 * | Step                                         | Source          | Confidence      |
 * | -------------------------------------------- | --------------- | --------------- |
 * | User correction                              | user            | 1.00            |
 * | User rule                                    | user_rule       | 0.98            |
 * | Dictionary, single-category merchant         | dictionary      | 0.92            |
 * | Dictionary, multi-category, user history     | dictionary      | 0.88            |
 * | Dictionary, multi-category, default          | dictionary      | 0.60            |
 * | Heuristic: keyword in merchant name          | classifier      | 0.60 to 0.75    |
 * | Heuristic: + small amount / morning (coffee) | classifier      | up to 0.85      |
 * | LLM (on-device or cloud), constrained choice | *_llm           | model, max 0.90 |
 * | Fallback (other.general)                     | none            | 0.00            |
 * | Income / transfer (not spending)             | none            | 1.00            |
 */
export const CONFIDENCE = {
  user: 1,
  userRule: 0.98,
  dictionary: 0.92,
  dictionaryHistory: 0.88,
  dictionaryMultiDefault: 0.6,
  llmMax: 0.9,
  fallback: 0,
  notSpending: 1,
} as const;

/** Prior confirmed transactions in one category needed to trust history at a multi-category merchant. */
export const MIN_HISTORY_MATCHES = 2;

/** Most review chips shown for one transaction (D-009: top-3 category chips). */
export const MAX_SUGGESTIONS = 3;

/**
 * Last-resort review chips, after every pipeline candidate and the user's month
 * favourites. The tail keeps three chips available when the first ones are taken.
 */
export const DEFAULT_SUGGESTIONS: readonly CategoryId[] = [
  'shopping.general',
  'food.groceries',
  'food.dining',
  'transport.general',
  'bills.utilities',
];

/** Chips for a payment to a person (D-009 "split, loan, rent, gift"). */
export const P2P_SUGGESTIONS: readonly CategoryId[] = [
  'food.dining',
  'housing.rent_mortgage',
  'gifts.general',
];

/** Upper bound on transactions re-categorized by one "apply to similar" correction. */
const APPLY_TO_SIMILAR_LIMIT = 1000;
const HISTORY_LIMIT = 50;

export interface CategorizerAgentDeps {
  repos: Pick<Repos, 'transactions' | 'userRules'>;
  /** Ids for new user rules. */
  newId?: IdGenerator;
  /** IANA zone for time-of-day hints. Defaults to the device zone. */
  timeZone?: string;
}

/** A category the pipeline considered, offered as a review chip. */
export interface CategorySuggestion {
  categoryId: CategoryId;
  confidence: number;
}

export interface CategoryChoice {
  categoryId: CategoryId;
  confidence: number;
  source: CategorySource;
  /** Set when a user rule fixes the kind as well. */
  kind?: TransactionKind;
  ruleId?: string;
}

/**
 * Categorizer (D-010, D-020): user rule -> merchant dictionary -> on-device heuristics
 * -> constrained LLM -> fallback. At or above AUTO_SAVE_CONFIDENCE the transaction is
 * confirmed, otherwise it needs review. Corrections become `merchant_exact` user rules.
 *
 * Income and transfers are not spending, so they skip classification (unless a user
 * rule matches) and are confirmed under the fallback category.
 *
 * Review: whenever a transaction needs review, `suggestions` carries up to three
 * other categories for the chips (see `suggestionsFor`). A payment to a person
 * through a P2P app always needs review (D-009) unless a user rule matches it.
 */
export function createCategorizerAgent(deps: CategorizerAgentDeps): Agent {
  const { repos } = deps;
  const newId = deps.newId ?? randomId;
  const timeZone = deps.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  async function categorize(event: StoredEvent<'transaction.parsed'>, ctx: AgentContext) {
    const tx = await repos.transactions.get(event.payload.transactionId);
    if (!tx || tx.deletedAt !== null) return [];

    const candidates: CategorySuggestion[] = [];
    let choice: CategoryChoice;
    if (tx.categorySource === 'user') {
      // Never override the user, but still announce so downstream agents run.
      choice = { categoryId: tx.categoryId, confidence: CONFIDENCE.user, source: 'user' };
    } else {
      choice = await chooseCategory(tx, ctx, event.id, candidates);
      // The native fast path may already have done better (e.g. a newer dictionary).
      if (tx.categorySource !== 'none' && tx.categoryConfidence > choice.confidence) {
        candidates.push({ categoryId: choice.categoryId, confidence: choice.confidence });
        choice = {
          categoryId: tx.categoryId,
          confidence: tx.categoryConfidence,
          source: tx.categorySource,
        };
      }
    }

    // D-009: a payment to a person always asks (split, loan, rent, gift), unless the
    // user already told us what payments to this person are.
    const askP2P =
      isPaymentToPerson(tx) && choice.source !== 'user' && choice.source !== 'user_rule';
    const needsReview = askP2P || choice.confidence < AUTO_SAVE_CONFIDENCE;
    const suggestions = needsReview
      ? await suggestionsFor(tx, choice, candidates, askP2P, ctx)
      : [];
    await repos.transactions.update(tx.id, {
      categoryId: choice.categoryId,
      categoryConfidence: choice.confidence,
      categorySource: choice.source,
      status: needsReview ? 'needs_review' : 'confirmed',
      updatedAt: ctx.now().toISOString(),
      ...(choice.kind ? { kind: choice.kind } : {}),
    });
    if (choice.ruleId) await repos.userRules.incrementHits(choice.ruleId, ctx.now().toISOString());

    const out: NewEvent = {
      type: 'transaction.categorized',
      payload: {
        transactionId: tx.id,
        categoryId: choice.categoryId,
        confidence: choice.confidence,
        source: choice.source,
        needsReview,
        ...(suggestions.length > 0 ? { suggestions } : {}),
      },
    };
    return [out];
  }

  /**
   * Runs the pipeline. Every step that produced a category but did not win
   * adds it to `candidates`, for the review chips.
   */
  async function chooseCategory(
    tx: Transaction,
    ctx: AgentContext,
    eventId: string,
    candidates: CategorySuggestion[],
  ): Promise<CategoryChoice> {
    const key = tx.merchantName ? toMerchantKey(tx.merchantName) : '';

    // 1. User rule.
    if (key) {
      const rule = await repos.userRules.findForMerchant(key);
      if (rule) {
        return {
          categoryId: rule.categoryId,
          confidence: CONFIDENCE.userRule,
          source: 'user_rule',
          ruleId: rule.id,
          ...(rule.kind ? { kind: rule.kind } : {}),
        };
      }
    }

    if (tx.kind === 'income' || tx.kind === 'transfer') {
      return {
        categoryId: FALLBACK_CATEGORY_ID,
        confidence: CONFIDENCE.notSpending,
        source: 'none',
      };
    }

    // 2. Merchant dictionary.
    const entry = key ? lookupMerchant(key) : undefined;
    if (entry && tx.merchantName) {
      if (!entry.multiCategory) {
        return {
          categoryId: entry.categoryId,
          confidence: CONFIDENCE.dictionary,
          source: 'dictionary',
        };
      }
      candidates.push({
        categoryId: entry.categoryId,
        confidence: CONFIDENCE.dictionaryMultiDefault,
      });
      const usual = await usualCategory(tx);
      return usual
        ? { categoryId: usual, confidence: CONFIDENCE.dictionaryHistory, source: 'dictionary' }
        : {
            categoryId: entry.categoryId,
            confidence: CONFIDENCE.dictionaryMultiDefault,
            source: 'dictionary',
          };
    }

    // 3. On-device heuristics.
    const hint = tx.merchantName ? heuristicCategory(tx, timeZone) : null;
    if (hint && hint.confidence >= AUTO_SAVE_CONFIDENCE) return hint;

    // 4./5. Constrained LLM, on-device or cloud as the port allows. A P2P
    // counterparty is a person's name and never goes to cloud AI (D-011 item 8).
    const llm = tx.merchantName
      ? await askLlm(tx, tx.merchantName, ctx, eventId, !isP2PDebit(tx))
      : null;
    const ranked = [hint, llm]
      .filter((c): c is CategoryChoice => c !== null)
      .sort((a, b) => b.confidence - a.confidence);
    for (const other of ranked) {
      candidates.push({ categoryId: other.categoryId, confidence: other.confidence });
    }
    const best = ranked[0];
    if (best) return best;

    // Fallback.
    return { categoryId: FALLBACK_CATEGORY_ID, confidence: CONFIDENCE.fallback, source: 'none' };
  }

  /** The user's most common confirmed category at this merchant, if seen often enough. */
  async function usualCategory(tx: Transaction): Promise<CategoryId | null> {
    const [top] = await merchantHistory(tx);
    return top && top.count >= MIN_HISTORY_MATCHES ? top.categoryId : null;
  }

  /** Confirmed expense categories at this merchant, most used first (ties: first seen). */
  async function merchantHistory(
    tx: Transaction,
  ): Promise<{ categoryId: CategoryId; count: number }[]> {
    if (!tx.merchantName) return [];
    const history = await repos.transactions.listByMerchant(tx.merchantName, HISTORY_LIMIT);
    const counts = new Map<CategoryId, number>();
    for (const other of history) {
      if (other.id === tx.id || other.status !== 'confirmed' || other.kind !== 'expense') continue;
      counts.set(other.categoryId, (counts.get(other.categoryId) ?? 0) + 1);
    }
    return [...counts]
      .map(([categoryId, count]) => ({ categoryId, count }))
      .sort((a, b) => b.count - a.count);
  }

  /** The user's most used confirmed expense categories in the current local month. */
  async function monthFavourites(tx: Transaction, ctx: AgentContext): Promise<CategoryId[]> {
    const period = monthPeriod(ctx.now(), timeZone);
    const rows = await repos.transactions.listBetween(period.start, period.end);
    const counts = new Map<CategoryId, number>();
    for (const row of rows) {
      if (row.id === tx.id || row.status !== 'confirmed' || row.kind !== 'expense') continue;
      counts.set(row.categoryId, (counts.get(row.categoryId) ?? 0) + 1);
    }
    return [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([categoryId]) => categoryId);
  }

  /**
   * Up to MAX_SUGGESTIONS review chips, best first, never the chosen category:
   * 1. Pipeline candidates and this merchant's history, by confidence
   *    (history confidence = share of past confirmed transactions × 0.88).
   *    For a payment to a person: history first, then the P2P chips.
   * 2. Padding: the user's most used categories this month, then DEFAULT_SUGGESTIONS.
   * FALLBACK_CATEGORY_ID only appears when nothing else is left. Padding chips
   * carry confidence 0: they are convenient, not predicted.
   */
  async function suggestionsFor(
    tx: Transaction,
    choice: CategoryChoice,
    candidates: readonly CategorySuggestion[],
    p2p: boolean,
    ctx: AgentContext,
  ): Promise<CategorySuggestion[]> {
    const history = await merchantHistory(tx);
    const total = history.reduce((sum, h) => sum + h.count, 0);
    const fromHistory = history.map((h) => ({
      categoryId: h.categoryId,
      confidence: (CONFIDENCE.dictionaryHistory * h.count) / total,
    }));

    const ranked: CategorySuggestion[] = p2p
      ? [
          ...fromHistory,
          ...P2P_SUGGESTIONS.map((categoryId) => ({ categoryId, confidence: 0 })),
          ...byConfidence(candidates),
        ]
      : byConfidence([...candidates, ...fromHistory]);

    const out: CategorySuggestion[] = [];
    const add = (s: CategorySuggestion) => {
      if (out.length >= MAX_SUGGESTIONS) return;
      if (s.categoryId === choice.categoryId || s.categoryId === FALLBACK_CATEGORY_ID) return;
      if (out.some((o) => o.categoryId === s.categoryId)) return;
      out.push({ categoryId: s.categoryId, confidence: clamp01(round2(s.confidence)) });
    };
    ranked.forEach(add);
    if (out.length < MAX_SUGGESTIONS) {
      for (const categoryId of await monthFavourites(tx, ctx)) add({ categoryId, confidence: 0 });
    }
    for (const categoryId of DEFAULT_SUGGESTIONS) add({ categoryId, confidence: 0 });
    if (out.length === 0 && choice.categoryId !== FALLBACK_CATEGORY_ID) {
      out.push({ categoryId: FALLBACK_CATEGORY_ID, confidence: 0 });
    }
    return out;
  }

  async function correct(event: StoredEvent<'transaction.user_corrected'>, ctx: AgentContext) {
    const { transactionId, categoryId, applyToSimilar } = event.payload;
    const tx = await repos.transactions.get(transactionId);
    if (!tx) return [];
    const now = ctx.now().toISOString();

    await repos.transactions.update(tx.id, {
      categoryId,
      categoryConfidence: CONFIDENCE.user,
      categorySource: 'user',
      status: 'confirmed',
      updatedAt: now,
    });

    const key = tx.merchantName ? toMerchantKey(tx.merchantName) : '';
    if (!key || !tx.merchantName) return [];

    const existing = await repos.userRules.findForMerchant(key);
    const rule: UserRule =
      existing && existing.matchType === 'merchant_exact' && existing.pattern === key
        ? { ...existing, categoryId, updatedAt: now }
        : {
            id: newId(),
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            matchType: 'merchant_exact',
            pattern: key,
            categoryId,
            kind: null,
            hits: 0,
          };
    await repos.userRules.upsert(rule);

    if (applyToSimilar) {
      const similar = await repos.transactions.listByMerchant(
        tx.merchantName,
        APPLY_TO_SIMILAR_LIMIT,
      );
      for (const other of similar) {
        if (other.id === tx.id || other.categorySource === 'user') continue;
        if (other.kind !== 'expense' && other.kind !== 'refund') continue;
        await repos.transactions.update(other.id, {
          categoryId,
          categoryConfidence: CONFIDENCE.userRule,
          categorySource: 'user_rule',
          status: 'confirmed',
          updatedAt: now,
        });
      }
    }
    // Corrections emit nothing: the UI made the change, and re-announcing as
    // `transaction.categorized` would re-run reconciliation and notifications.
    return [];
  }

  return {
    name: CATEGORIZER_AGENT_NAME,
    subscribes: ['transaction.parsed', 'transaction.user_corrected'],
    async handle(event, ctx) {
      if (event.type === 'transaction.parsed') return categorize(event, ctx);
      if (event.type === 'transaction.user_corrected') return correct(event, ctx);
      return [];
    },
  };
}

/** A debit from a P2P app (Venmo, Cash App, Zelle, PayPal). */
export function isP2PDebit(tx: Pick<Transaction, 'kind' | 'issuerId'>): boolean {
  return tx.kind === 'expense' && tx.issuerId !== null && P2P_ISSUER_IDS.has(tx.issuerId);
}

/**
 * A P2P debit whose counterparty is not a known business. P2P apps also pay
 * merchants (e.g. PayPal checkout at a dictionary merchant); those are
 * categorized like any other purchase. Only payments to people always ask.
 */
export function isPaymentToPerson(
  tx: Pick<Transaction, 'kind' | 'issuerId' | 'merchantName'>,
): boolean {
  if (!isP2PDebit(tx)) return false;
  const key = tx.merchantName ? toMerchantKey(tx.merchantName) : '';
  return !key || lookupMerchant(key) === undefined;
}

function byConfidence(list: readonly CategorySuggestion[]): CategorySuggestion[] {
  // Stable: equal confidences keep pipeline order.
  return [...list].sort((a, b) => b.confidence - a.confidence);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
}

async function askLlm(
  tx: Transaction,
  merchant: string,
  ctx: AgentContext,
  eventId: string,
  allowCloud: boolean,
): Promise<CategoryChoice | null> {
  try {
    const tier = await ctx.llm.tier();
    if (tier === 'none' || (tier === 'cloud' && !allowCloud)) return null;
    // Minimal payload (D-011): merchant name and amount only.
    const result = await ctx.llm.chooseCategory({
      merchant,
      amountMinor: tx.amountMinor,
      allowed: BUILT_IN_CATEGORY_IDS,
    });
    if (!result || !isBuiltInCategoryId(result.categoryId)) return null;
    const confidence = Number.isFinite(result.confidence)
      ? Math.min(Math.max(result.confidence, 0), CONFIDENCE.llmMax)
      : 0;
    return {
      categoryId: result.categoryId,
      confidence,
      source: tier === 'cloud' ? 'cloud_llm' : 'on_device_llm',
    };
  } catch (error) {
    const reason = error instanceof Error ? error.name : 'non-error thrown';
    ctx.log.warn(`LLM categorization failed (${reason})`, {
      agent: CATEGORIZER_AGENT_NAME,
      eventId,
    });
    return null;
  }
}

type KeywordHint = { pattern: RegExp; categoryId: CategoryId; confidence: number };

/** Whole-word keyword hints on the merchant name. First match wins. */
const KEYWORD_HINTS: readonly KeywordHint[] = [
  {
    pattern: /\b(coffee|cafe|espresso|roasters?|coffeehouse)\b/i,
    categoryId: 'food.coffee',
    confidence: 0.75,
  },
  {
    pattern: /\b(gas|fuel|petro(leum)?|ev charging)\b/i,
    categoryId: 'transport.gas',
    confidence: 0.75,
  },
  {
    pattern:
      /\b(restaurant|grill|pizza|pizzeria|sushi|taco|tacos|burgers?|kitchen|diner|bistro|bbq|cantina|ramen|bar|pub|tavern|eatery|deli)\b/i,
    categoryId: 'food.dining',
    confidence: 0.75,
  },
  {
    pattern: /\b(grocery|groceries|supermarket|market|foods)\b/i,
    categoryId: 'food.groceries',
    confidence: 0.65,
  },
  {
    pattern: /\b(pharmacy|clinic|dental|dentist|medical|hospital|health|optometry|gym|fitness)\b/i,
    categoryId: 'health.general',
    confidence: 0.75,
  },
  {
    pattern: /\b(parking|transit|taxi|cab|tolls?|car wash)\b/i,
    categoryId: 'transport.general',
    confidence: 0.75,
  },
  {
    pattern: /\b(hotel|motel|inn|resort|airlines?|airways)\b/i,
    categoryId: 'travel.general',
    confidence: 0.75,
  },
  {
    pattern: /\b(salon|barber|barbershop|spa|nails|laundry|laundromat|cleaners)\b/i,
    categoryId: 'personal_care.general',
    confidence: 0.75,
  },
  {
    pattern: /\b(electric|power|water|utilities|utility|internet|wireless|insurance)\b/i,
    categoryId: 'bills.utilities',
    confidence: 0.65,
  },
  {
    pattern: /\b(apartments?|rent|property management|mortgage|hoa)\b/i,
    categoryId: 'housing.rent_mortgage',
    confidence: 0.65,
  },
  {
    pattern: /\b(cinema|theater|theatre|bowling|arcade|museum|books?)\b/i,
    categoryId: 'entertainment.general',
    confidence: 0.65,
  },
  {
    pattern: /\b(florist|flowers|gifts?|charity|donation)\b/i,
    categoryId: 'gifts.general',
    confidence: 0.6,
  },
];

/** Coffee purchases at or under this amount (cents) get a small-amount boost. */
const SMALL_COFFEE_MAX_MINOR = 1000;
const HINT_BOOST = 0.05;

/**
 * Simple on-device classifier: merchant-name keywords, plus amount and time-of-day
 * context for cafés (a $4.75 morning charge at "Sunrise Cafe" is coffee).
 */
export function heuristicCategory(
  tx: Pick<Transaction, 'merchantName' | 'amountMinor' | 'occurredAt'>,
  timeZone: string,
): CategoryChoice | null {
  const name = tx.merchantName ?? '';
  const hint = KEYWORD_HINTS.find((h) => h.pattern.test(name));
  if (!hint) return null;
  let confidence = hint.confidence;
  if (hint.categoryId === 'food.coffee') {
    if (tx.amountMinor <= SMALL_COFFEE_MAX_MINOR) confidence += HINT_BOOST;
    const hour = localHour(tx.occurredAt, timeZone);
    if (hour !== null && hour >= 5 && hour < 11) confidence += HINT_BOOST;
  }
  return {
    categoryId: hint.categoryId,
    confidence: Math.round(confidence * 100) / 100,
    source: 'classifier',
  };
}

function localHour(iso: string, timeZone: string): number | null {
  try {
    const hour = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone,
    }).format(new Date(iso));
    const value = Number(hour);
    return Number.isInteger(value) ? value : null;
  } catch {
    return null;
  }
}
