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
import { randomId, type IdGenerator } from '../event-bus';
import type { Repos, UserRule } from '../ports';

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
 */
export function createCategorizerAgent(deps: CategorizerAgentDeps): Agent {
  const { repos } = deps;
  const newId = deps.newId ?? randomId;
  const timeZone = deps.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  async function categorize(event: StoredEvent<'transaction.parsed'>, ctx: AgentContext) {
    const tx = await repos.transactions.get(event.payload.transactionId);
    if (!tx || tx.deletedAt !== null) return [];

    let choice: CategoryChoice;
    if (tx.categorySource === 'user') {
      // Never override the user, but still announce so downstream agents run.
      choice = { categoryId: tx.categoryId, confidence: CONFIDENCE.user, source: 'user' };
    } else {
      choice = await chooseCategory(tx, ctx, event.id);
      // The native fast path may already have done better (e.g. a newer dictionary).
      if (tx.categorySource !== 'none' && tx.categoryConfidence > choice.confidence) {
        choice = {
          categoryId: tx.categoryId,
          confidence: tx.categoryConfidence,
          source: tx.categorySource,
        };
      }
    }

    const needsReview = choice.confidence < AUTO_SAVE_CONFIDENCE;
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
      },
    };
    return [out];
  }

  async function chooseCategory(
    tx: Transaction,
    ctx: AgentContext,
    eventId: string,
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

    // 4./5. Constrained LLM, on-device or cloud as the port allows.
    const llm = tx.merchantName ? await askLlm(tx, tx.merchantName, ctx, eventId) : null;
    const best = [hint, llm]
      .filter((c): c is CategoryChoice => c !== null)
      .sort((a, b) => b.confidence - a.confidence)[0];
    if (best) return best;

    // Fallback.
    return { categoryId: FALLBACK_CATEGORY_ID, confidence: CONFIDENCE.fallback, source: 'none' };
  }

  /** The user's most common confirmed category at this merchant, if seen often enough. */
  async function usualCategory(tx: Transaction): Promise<CategoryId | null> {
    if (!tx.merchantName) return null;
    const history = await repos.transactions.listByMerchant(tx.merchantName, HISTORY_LIMIT);
    const counts = new Map<CategoryId, number>();
    for (const other of history) {
      if (other.id === tx.id || other.status !== 'confirmed' || other.kind !== 'expense') continue;
      counts.set(other.categoryId, (counts.get(other.categoryId) ?? 0) + 1);
    }
    let best: CategoryId | null = null;
    let bestCount = 0;
    for (const [categoryId, count] of counts) {
      if (count > bestCount) {
        best = categoryId;
        bestCount = count;
      }
    }
    return bestCount >= MIN_HISTORY_MATCHES ? best : null;
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

async function askLlm(
  tx: Transaction,
  merchant: string,
  ctx: AgentContext,
  eventId: string,
): Promise<CategoryChoice | null> {
  try {
    const tier = await ctx.llm.tier();
    if (tier === 'none') return null;
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
