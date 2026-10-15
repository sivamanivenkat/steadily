import { describe, expect, it, vi } from 'vitest';
import type {
  AgentContext,
  EventPayload,
  LlmPort,
  StoredEvent,
  Transaction,
} from '@steadily/shared-types';
import { createInMemoryRepos, type UserRule } from '../ports';
import {
  createCapturingLogger,
  createFixedClock,
  createNoopLlm,
  createSequentialIds,
} from '../testing';
import { CONFIDENCE, createCategorizerAgent, heuristicCategory } from './categorizer';

// Synthetic data only.
const TX_1 = '00000000-0000-4000-8000-0000000000a1';
const TX_2 = '00000000-0000-4000-8000-0000000000a2';
const TX_3 = '00000000-0000-4000-8000-0000000000a3';
const TX_4 = '00000000-0000-4000-8000-0000000000a4';
const EVENT_1 = '00000000-0000-4000-8000-0000000000e1';
const NOW = '2026-10-15T08:00:00.000Z';
const TZ = 'America/New_York';

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: TX_1,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    occurredAt: '2026-10-14T15:12:00.000Z',
    amountMinor: 2540,
    currency: 'USD',
    kind: 'expense',
    merchantRaw: 'STARBUCKS STORE 1234',
    merchantName: 'Starbucks',
    categoryId: 'other.general',
    categoryConfidence: 0,
    categorySource: 'none',
    status: 'needs_review',
    source: 'ios_sms_shortcut',
    accountLast4: null,
    issuerId: 'chase',
    txnRef: null,
    note: null,
    linkedTransactionId: null,
    ...overrides,
  };
}

function makeRule(overrides: Partial<UserRule> = {}): UserRule {
  return {
    id: '00000000-0000-4000-8000-0000000000f1',
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    matchType: 'merchant_exact',
    pattern: 'starbucks',
    categoryId: 'food.dining',
    kind: null,
    hits: 3,
    ...overrides,
  };
}

function setup(llm: LlmPort = createNoopLlm()) {
  const repos = createInMemoryRepos();
  const log = createCapturingLogger();
  const clock = createFixedClock(NOW);
  const ctx: AgentContext = { now: clock, llm, log };
  const agent = createCategorizerAgent({ repos, newId: createSequentialIds(), timeZone: TZ });
  const add = async (overrides: Partial<Transaction> = {}) => {
    const tx = makeTx(overrides);
    await repos.transactions.insert(tx);
    return tx;
  };
  return { repos, log, ctx, agent, add };
}

function parsed(transactionId = TX_1): StoredEvent<'transaction.parsed'> {
  return {
    id: EVENT_1,
    type: 'transaction.parsed',
    at: NOW,
    causationId: null,
    payload: { transactionId },
  };
}

function corrected(
  payload: Partial<EventPayload<'transaction.user_corrected'>> = {},
): StoredEvent<'transaction.user_corrected'> {
  return {
    id: EVENT_1,
    type: 'transaction.user_corrected',
    at: NOW,
    causationId: null,
    payload: {
      transactionId: TX_1,
      previousCategoryId: 'shopping.general',
      categoryId: 'food.groceries',
      applyToSimilar: false,
      ...payload,
    },
  };
}

function fakeLlm(
  tier: 'on_device' | 'cloud',
  result: Awaited<ReturnType<LlmPort['chooseCategory']>>,
): LlmPort & { chooseCategory: ReturnType<typeof vi.fn> } {
  return { tier: async () => tier, chooseCategory: vi.fn(async () => result) };
}

describe('Categorizer agent', () => {
  it('applies a user rule first and counts the hit', async () => {
    const { repos, ctx, agent, add } = setup();
    await add();
    await repos.userRules.upsert(makeRule({ kind: 'expense' }));

    const out = await agent.handle(parsed(), ctx);

    expect(out).toEqual([
      {
        type: 'transaction.categorized',
        payload: {
          transactionId: TX_1,
          categoryId: 'food.dining',
          confidence: CONFIDENCE.userRule,
          source: 'user_rule',
          needsReview: false,
        },
      },
    ]);
    expect(await repos.transactions.get(TX_1)).toMatchObject({
      categoryId: 'food.dining',
      categorySource: 'user_rule',
      status: 'confirmed',
    });
    expect(repos.userRules.rows.get(makeRule().id)?.hits).toBe(4);
  });

  it('uses the merchant dictionary for single-category merchants', async () => {
    const { repos, ctx, agent, add } = setup();
    await add();

    const out = await agent.handle(parsed(), ctx);

    expect(out[0]?.payload).toMatchObject({
      categoryId: 'food.coffee',
      confidence: CONFIDENCE.dictionary,
      source: 'dictionary',
      needsReview: false,
    });
    expect((await repos.transactions.get(TX_1))?.status).toBe('confirmed');
  });

  it('asks for review at a multi-category merchant without history', async () => {
    const { repos, ctx, agent, add } = setup();
    await add({ merchantName: 'Amazon', merchantRaw: 'AMAZON.COM*AB12CD34' });

    const out = await agent.handle(parsed(), ctx);

    expect(out[0]?.payload).toMatchObject({
      categoryId: 'shopping.general',
      confidence: CONFIDENCE.dictionaryMultiDefault,
      needsReview: true,
    });
    expect((await repos.transactions.get(TX_1))?.status).toBe('needs_review');
  });

  it("uses the user's usual category at a multi-category merchant", async () => {
    const { ctx, agent, add } = setup();
    const history = { merchantName: 'Amazon', status: 'confirmed' as const };
    await add({ ...history, id: TX_2, categoryId: 'food.groceries', categorySource: 'user' });
    await add({ ...history, id: TX_3, categoryId: 'food.groceries', categorySource: 'user' });
    await add({ ...history, id: TX_4, categoryId: 'shopping.general' });
    await add({ merchantName: 'Amazon' });

    const out = await agent.handle(parsed(), ctx);

    expect(out[0]?.payload).toMatchObject({
      categoryId: 'food.groceries',
      confidence: CONFIDENCE.dictionaryHistory,
      needsReview: false,
    });
  });

  it('needs at least two confirmed matches before trusting history', async () => {
    const { ctx, agent, add } = setup();
    await add({
      id: TX_2,
      merchantName: 'Amazon',
      categoryId: 'food.groceries',
      status: 'confirmed',
    });
    await add({ id: TX_3, merchantName: 'Amazon', categoryId: 'food.groceries' }); // unconfirmed
    await add({ merchantName: 'Amazon' });

    const out = await agent.handle(parsed(), ctx);

    expect(out[0]?.payload).toMatchObject({ categoryId: 'shopping.general', needsReview: true });
  });

  it('auto-saves a small morning café purchase from heuristics', async () => {
    const { ctx, agent, add } = setup();
    // 08:30 in New York.
    await add({
      merchantName: 'Sunrise Cafe',
      amountMinor: 625,
      occurredAt: '2026-10-14T12:30:00.000Z',
    });

    const out = await agent.handle(parsed(), ctx);

    expect(out[0]?.payload).toMatchObject({
      categoryId: 'food.coffee',
      confidence: 0.85,
      source: 'classifier',
      needsReview: false,
    });
  });

  it('keeps an evening café dinner in review', () => {
    const hint = heuristicCategory(
      { merchantName: 'Sunrise Cafe', amountMinor: 4200, occurredAt: '2026-10-15T00:30:00.000Z' },
      TZ,
    );
    expect(hint).toEqual({ categoryId: 'food.coffee', confidence: 0.75, source: 'classifier' });
  });

  it('does not call the LLM when no tier is available', async () => {
    const llm = { ...createNoopLlm(), chooseCategory: vi.fn(async () => null) };
    const { ctx, agent, add } = setup(llm);
    await add({ merchantName: 'Zyx Holdings', merchantRaw: 'ZYX HOLDINGS' });

    const out = await agent.handle(parsed(), ctx);

    expect(llm.chooseCategory).not.toHaveBeenCalled();
    expect(out[0]?.payload).toMatchObject({
      categoryId: 'other.general',
      confidence: 0,
      source: 'none',
      needsReview: true,
    });
  });

  it('uses the on-device LLM with a constrained, minimal request', async () => {
    const llm = fakeLlm('on_device', { categoryId: 'shopping.general', confidence: 0.99 });
    const { ctx, agent, add } = setup(llm);
    await add({ merchantName: 'Zyx Holdings', merchantRaw: 'ZYX HOLDINGS', amountMinor: 1999 });

    const out = await agent.handle(parsed(), ctx);

    expect(llm.chooseCategory).toHaveBeenCalledTimes(1);
    const request = llm.chooseCategory.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(request).sort()).toEqual(['allowed', 'amountMinor', 'merchant']);
    expect(request.merchant).toBe('Zyx Holdings');
    expect(request.allowed).toContain('food.coffee');
    expect(out[0]?.payload).toMatchObject({
      categoryId: 'shopping.general',
      confidence: CONFIDENCE.llmMax,
      source: 'on_device_llm',
      needsReview: false,
    });
  });

  it('labels cloud results and prefers a stronger heuristic', async () => {
    const llm = fakeLlm('cloud', { categoryId: 'shopping.general', confidence: 0.5 });
    const { ctx, agent, add } = setup(llm);
    await add({ merchantName: 'Harbor Grill', merchantRaw: 'HARBOR GRILL' });

    const out = await agent.handle(parsed(), ctx);

    expect(out[0]?.payload).toMatchObject({ categoryId: 'food.dining', source: 'classifier' });

    const llm2 = fakeLlm('cloud', { categoryId: 'travel.general', confidence: 0.8 });
    const second = setup(llm2);
    await second.add({ merchantName: 'Zyx Holdings' });
    const out2 = await second.agent.handle(parsed(), second.ctx);
    expect(out2[0]?.payload).toMatchObject({ source: 'cloud_llm', needsReview: true });
  });

  it('ignores LLM answers outside the taxonomy', async () => {
    const llm = fakeLlm('on_device', {
      categoryId: 'custom.made_up',
      confidence: 0.99,
    });
    const { ctx, agent, add } = setup(llm);
    await add({ merchantName: 'Zyx Holdings' });

    const out = await agent.handle(parsed(), ctx);

    expect(out[0]?.payload).toMatchObject({ categoryId: 'other.general', source: 'none' });
  });

  it('falls back quietly when the LLM fails, logging no transaction data', async () => {
    const llm: LlmPort = {
      tier: async () => 'on_device',
      chooseCategory: async () => {
        throw new TypeError('model failed on Zyx Holdings 1999');
      },
    };
    const { ctx, log, agent, add } = setup(llm);
    await add({ merchantName: 'Zyx Holdings' });

    const out = await agent.handle(parsed(), ctx);

    expect(out[0]?.payload).toMatchObject({ categoryId: 'other.general' });
    expect(log.entries).toHaveLength(1);
    expect(JSON.stringify(log.entries)).not.toContain('Zyx');
  });

  it('confirms income and transfers without classifying them', async () => {
    const { ctx, agent, add } = setup();
    await add({ kind: 'transfer', merchantName: 'Alex Sample' });

    const out = await agent.handle(parsed(), ctx);

    expect(out[0]?.payload).toMatchObject({
      categoryId: 'other.general',
      confidence: CONFIDENCE.notSpending,
      source: 'none',
      needsReview: false,
    });
  });

  it('never overrides a category the user set', async () => {
    const { repos, ctx, agent, add } = setup();
    await add({ categoryId: 'gifts.general', categorySource: 'user', status: 'confirmed' });

    const out = await agent.handle(parsed(), ctx);

    expect(out[0]?.payload).toMatchObject({ categoryId: 'gifts.general', source: 'user' });
    expect((await repos.transactions.get(TX_1))?.categoryId).toBe('gifts.general');
  });

  it('keeps a stronger quick category from the native fast path', async () => {
    const { ctx, agent, add } = setup();
    await add({
      merchantName: 'Zyx Holdings',
      categoryId: 'bills.utilities',
      categoryConfidence: 0.9,
      categorySource: 'dictionary',
    });

    const out = await agent.handle(parsed(), ctx);

    expect(out[0]?.payload).toMatchObject({ categoryId: 'bills.utilities', confidence: 0.9 });
  });

  it('emits nothing for a missing or deleted transaction', async () => {
    const { ctx, agent, add } = setup();
    expect(await agent.handle(parsed(), ctx)).toEqual([]);
    await add({ deletedAt: NOW });
    expect(await agent.handle(parsed(), ctx)).toEqual([]);
  });

  describe('user corrections', () => {
    it('confirms the transaction and learns a merchant rule', async () => {
      const { repos, ctx, agent, add } = setup();
      await add({ merchantName: 'Amazon', categoryId: 'shopping.general' });

      const out = await agent.handle(corrected(), ctx);

      expect(out).toEqual([]);
      expect(await repos.transactions.get(TX_1)).toMatchObject({
        categoryId: 'food.groceries',
        categoryConfidence: 1,
        categorySource: 'user',
        status: 'confirmed',
      });
      expect([...repos.userRules.rows.values()]).toEqual([
        expect.objectContaining({
          matchType: 'merchant_exact',
          pattern: 'amazon',
          categoryId: 'food.groceries',
          hits: 0,
        }),
      ]);
    });

    it('updates the existing rule instead of adding another', async () => {
      const { repos, ctx, agent, add } = setup();
      await add({ merchantName: 'Amazon' });
      await repos.userRules.upsert(makeRule({ pattern: 'amazon', categoryId: 'shopping.general' }));

      await agent.handle(corrected(), ctx);

      expect([...repos.userRules.rows.values()]).toEqual([
        expect.objectContaining({ id: makeRule().id, categoryId: 'food.groceries', hits: 3 }),
      ]);
    });

    it('re-categorizes similar transactions when asked, sparing user-set ones', async () => {
      const { repos, ctx, agent, add } = setup();
      await add({ merchantName: 'Amazon' });
      await add({ id: TX_2, merchantName: 'Amazon', categorySource: 'dictionary' });
      await add({
        id: TX_3,
        merchantName: 'Amazon',
        categoryId: 'gifts.general',
        categorySource: 'user',
      });
      await add({ id: TX_4, merchantName: 'Target' });

      await agent.handle(corrected({ applyToSimilar: true }), ctx);

      expect(await repos.transactions.get(TX_2)).toMatchObject({
        categoryId: 'food.groceries',
        categorySource: 'user_rule',
        status: 'confirmed',
      });
      expect((await repos.transactions.get(TX_3))?.categoryId).toBe('gifts.general');
      expect((await repos.transactions.get(TX_4))?.categoryId).toBe('other.general');
    });

    it('leaves similar transactions alone by default', async () => {
      const { repos, ctx, agent, add } = setup();
      await add({ merchantName: 'Amazon' });
      await add({ id: TX_2, merchantName: 'Amazon' });

      await agent.handle(corrected(), ctx);

      expect((await repos.transactions.get(TX_2))?.categoryId).toBe('other.general');
    });

    it('then categorizes new transactions with the learned rule', async () => {
      const { ctx, agent, add } = setup();
      await add({ merchantName: 'Amazon' });
      await agent.handle(corrected(), ctx);
      await add({ id: TX_2, merchantName: 'Amazon' });

      const out = await agent.handle(parsed(TX_2), ctx);

      expect(out[0]?.payload).toMatchObject({ categoryId: 'food.groceries', source: 'user_rule' });
    });
  });
});
