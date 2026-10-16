import {
  createCapturingLogger,
  createCategorizerAgent,
  createFixedClock,
  createInMemoryRepos,
  createNoopLlm,
} from '@steadily/agent-core';
import { normalizeMerchant } from '@steadily/merchants';
import type {
  AgentContext,
  CategorySource,
  StoredEvent,
  Transaction,
} from '@steadily/shared-types';
import { BUILT_IN_CATEGORY_IDS, type CategoryId } from '@steadily/taxonomy';
import type { LabeledTransaction } from './dataset';

/** Evals run in UTC so `hourLocal` maps straight onto `occurredAt`. */
const TIME_ZONE = 'UTC';
const NOW = '2026-10-15T08:00:00.000Z';
const TX_ID = '00000000-0000-4000-8000-0000000000a1';
const EVENT_ID = '00000000-0000-4000-8000-0000000000e1';

export interface CategorizeOutcome {
  item: LabeledTransaction;
  merchantName: string | null;
  categoryId: CategoryId;
  confidence: number;
  source: CategorySource;
  needsReview: boolean;
  correct: boolean;
}

function toTransaction(item: LabeledTransaction): Transaction {
  const name = normalizeMerchant(item.merchantRaw).name;
  const hh = String(item.hourLocal).padStart(2, '0');
  return {
    id: TX_ID,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    occurredAt: `2026-10-14T${hh}:30:00.000Z`,
    amountMinor: item.amountMinor,
    currency: 'USD',
    kind: 'expense',
    merchantRaw: item.merchantRaw,
    merchantName: name || null,
    categoryId: 'other.general',
    categoryConfidence: 0,
    categorySource: 'none',
    status: 'needs_review',
    source: 'share_text',
    accountLast4: null,
    issuerId: item.issuerId ?? null,
    txnRef: null,
    note: null,
    linkedTransactionId: null,
  };
}

/**
 * Runs one labeled item through the Categorizer agent exactly as the runtime would after
 * the Parser: fresh in-memory repos (no history, no user rules) and no LLM, so the result
 * is the deterministic on-device baseline.
 */
export async function categorizeItem(item: LabeledTransaction): Promise<CategorizeOutcome> {
  const repos = createInMemoryRepos();
  const tx = toTransaction(item);
  await repos.transactions.insert(tx);
  const agent = createCategorizerAgent({ repos, timeZone: TIME_ZONE });
  const ctx: AgentContext = {
    now: createFixedClock(NOW),
    llm: createNoopLlm(),
    log: createCapturingLogger(),
  };
  const event: StoredEvent<'transaction.parsed'> = {
    id: EVENT_ID,
    type: 'transaction.parsed',
    at: NOW,
    causationId: null,
    payload: { transactionId: tx.id },
  };
  const [out] = await agent.handle(event, ctx);
  if (!out || out.type !== 'transaction.categorized') {
    throw new Error(`categorizer emitted nothing for item ${item.id}`);
  }
  const p = out.payload;
  return {
    item,
    merchantName: tx.merchantName,
    categoryId: p.categoryId,
    confidence: p.confidence,
    source: p.source,
    needsReview: p.needsReview,
    correct: p.categoryId === item.expectedCategoryId,
  };
}

export interface CategoryStats {
  categoryId: string;
  support: number;
  predicted: number;
  truePositives: number;
  precision: number | null;
  recall: number | null;
}

export interface SliceStats {
  tag: string;
  total: number;
  correct: number;
  autoSaved: number;
}

export interface CategorizeReport {
  total: number;
  correct: number;
  accuracy: number;
  autoSaved: number;
  autoSaveRate: number;
  autoSavedCorrect: number;
  /** Accuracy among auto-saved items; 1 when nothing was auto-saved. */
  autoSavedAccuracy: number;
  reviewLabeled: number;
  reviewAgreement: number;
  perCategory: CategoryStats[];
  slices: SliceStats[];
  confusions: CategorizeOutcome[];
  outcomes: CategorizeOutcome[];
}

const ratio = (n: number, d: number, empty = 1) => (d === 0 ? empty : n / d);

export async function runCategorizeEval(
  items: readonly LabeledTransaction[],
): Promise<CategorizeReport> {
  const outcomes: CategorizeOutcome[] = [];
  for (const item of items) outcomes.push(await categorizeItem(item));

  const correct = outcomes.filter((o) => o.correct).length;
  const auto = outcomes.filter((o) => !o.needsReview);
  const autoCorrect = auto.filter((o) => o.correct).length;
  const labeled = outcomes.filter((o) => o.item.expectedNeedsReview !== undefined);
  const agree = labeled.filter((o) => o.needsReview === o.item.expectedNeedsReview).length;

  const perCategory = BUILT_IN_CATEGORY_IDS.map((categoryId): CategoryStats => {
    const support = outcomes.filter((o) => o.item.expectedCategoryId === categoryId).length;
    const predicted = outcomes.filter((o) => o.categoryId === categoryId).length;
    const truePositives = outcomes.filter(
      (o) => o.correct && o.categoryId === categoryId,
    ).length;
    return {
      categoryId,
      support,
      predicted,
      truePositives,
      precision: predicted === 0 ? null : truePositives / predicted,
      recall: support === 0 ? null : truePositives / support,
    };
  });

  const tags = [...new Set(outcomes.flatMap((o) => o.item.tags ?? []))].sort();
  const slices = tags.map((tag): SliceStats => {
    const inSlice = outcomes.filter((o) => o.item.tags?.includes(tag));
    return {
      tag,
      total: inSlice.length,
      correct: inSlice.filter((o) => o.correct).length,
      autoSaved: inSlice.filter((o) => !o.needsReview).length,
    };
  });

  return {
    total: outcomes.length,
    correct,
    accuracy: ratio(correct, outcomes.length, 0),
    autoSaved: auto.length,
    autoSaveRate: ratio(auto.length, outcomes.length, 0),
    autoSavedCorrect: autoCorrect,
    autoSavedAccuracy: ratio(autoCorrect, auto.length),
    reviewLabeled: labeled.length,
    reviewAgreement: ratio(agree, labeled.length),
    perCategory,
    slices,
    confusions: outcomes.filter((o) => !o.correct),
    outcomes,
  };
}
