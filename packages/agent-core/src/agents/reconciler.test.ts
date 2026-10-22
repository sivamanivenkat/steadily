import { describe, expect, it } from 'vitest';
import type { AgentContext, StoredEvent, Transaction } from '@steadily/shared-types';
import { createInMemoryRepos } from '../ports';
import { createCapturingLogger, createFixedClock, createNoopLlm } from '../testing';
import { createReconcilerAgent, looksLikeTransfer } from './reconciler';

// Synthetic data only. Ids sort in creation order (ties on createdAt break by id).
const TX_1 = '00000000-0000-4000-8000-0000000000a1';
const TX_2 = '00000000-0000-4000-8000-0000000000a2';
const TX_3 = '00000000-0000-4000-8000-0000000000a3';
const EVENT_1 = '00000000-0000-4000-8000-0000000000e1';
const NOW = '2026-10-15T08:00:00.000Z';

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
    categoryId: 'food.coffee',
    categoryConfidence: 0.92,
    categorySource: 'dictionary',
    status: 'confirmed',
    source: 'ios_sms_shortcut',
    accountLast4: null,
    issuerId: 'chase',
    txnRef: null,
    note: null,
    linkedTransactionId: null,
    ...overrides,
  };
}

function setup() {
  const repos = createInMemoryRepos();
  const clock = createFixedClock(NOW);
  const ctx: AgentContext = { now: clock, llm: createNoopLlm(), log: createCapturingLogger() };
  const agent = createReconcilerAgent({ repos });
  const add = async (overrides: Partial<Transaction> = {}) => {
    const tx = makeTx(overrides);
    await repos.transactions.insert(tx);
    return tx;
  };
  return { repos, ctx, agent, add };
}

function categorized(transactionId: string): StoredEvent<'transaction.categorized'> {
  return {
    id: EVENT_1,
    type: 'transaction.categorized',
    at: NOW,
    causationId: null,
    payload: {
      transactionId,
      categoryId: 'food.coffee',
      confidence: 0.92,
      source: 'dictionary',
      needsReview: false,
    },
  };
}

const logged = (transactionId: string) => ({
  type: 'notify.request',
  payload: { kind: 'transaction_logged', urgency: 'summary', transactionId },
});

describe('Reconciler agent', () => {
  it('reports a plain transaction as new and asks for a summary notification', async () => {
    const { ctx, agent, add } = setup();
    await add();

    const out = await agent.handle(categorized(TX_1), ctx);

    expect(out).toEqual([
      { type: 'transaction.reconciled', payload: { transactionId: TX_1, outcome: 'new' } },
      logged(TX_1),
    ]);
  });

  it('asks for an instant notification when the transaction needs review', async () => {
    const { ctx, agent, add } = setup();
    await add({ status: 'needs_review' });

    const out = await agent.handle(categorized(TX_1), ctx);

    expect(out[1]).toEqual({
      type: 'notify.request',
      payload: { kind: 'transaction_needs_review', urgency: 'instant', transactionId: TX_1 },
    });
  });

  it.each(['csv_import', 'manual'] as const)(
    'does not ask for a notification for %s entries',
    async (source) => {
      const { ctx, agent, add } = setup();
      await add({ source, status: 'needs_review' });

      const out = await agent.handle(categorized(TX_1), ctx);

      expect(out).toEqual([
        { type: 'transaction.reconciled', payload: { transactionId: TX_1, outcome: 'new' } },
      ]);
    },
  );

  it('soft-deletes a newer transaction with the same issuer reference', async () => {
    const { repos, ctx, agent, add } = setup();
    await add({ txnRef: 'REF-1' });
    await add({ id: TX_2, txnRef: 'REF-1', occurredAt: '2026-10-14T18:00:00.000Z' });

    const out = await agent.handle(categorized(TX_2), ctx);

    expect(out).toEqual([
      {
        type: 'transaction.reconciled',
        payload: { transactionId: TX_2, outcome: 'duplicate', relatedTransactionId: TX_1 },
      },
    ]);
    expect(await repos.transactions.get(TX_2)).toMatchObject({
      deletedAt: NOW,
      linkedTransactionId: TX_1,
    });
    expect((await repos.transactions.get(TX_1))?.deletedAt).toBeNull();
  });

  it('treats the same amount from another source within 5 minutes as a duplicate', async () => {
    const { ctx, agent, add } = setup();
    await add();
    await add({
      id: TX_2,
      source: 'android_notification',
      occurredAt: '2026-10-14T15:16:00.000Z',
      accountLast4: '4821',
    });

    const out = await agent.handle(categorized(TX_2), ctx);

    expect(out[0]?.payload).toMatchObject({ outcome: 'duplicate', relatedTransactionId: TX_1 });
  });

  it.each([
    ['the same source', { source: 'ios_sms_shortcut' as const }],
    ['more than 5 minutes apart', { occurredAt: '2026-10-14T15:17:01.000Z' }],
    ['a different card', { accountLast4: '9999' }],
    ['a different issuer', { issuerId: 'citi' }],
    ['a different issuer reference', { txnRef: 'REF-2' }],
    ['a different kind', { kind: 'refund' as const }],
  ])('keeps same-amount transactions from %s', async (_, overrides) => {
    const { ctx, agent, add } = setup();
    await add({ accountLast4: '4821', txnRef: 'REF-1' });
    await add({ id: TX_2, source: 'android_notification', merchantName: null, ...overrides });

    const out = await agent.handle(categorized(TX_2), ctx);

    expect(out[0]?.payload).toMatchObject({ outcome: 'new' });
  });

  it('is idempotent: a duplicate is not processed twice', async () => {
    const { ctx, agent, add } = setup();
    await add({ txnRef: 'REF-1' });
    await add({ id: TX_2, txnRef: 'REF-1' });
    await agent.handle(categorized(TX_2), ctx);

    expect(await agent.handle(categorized(TX_2), ctx)).toEqual([]);
  });

  it('links a refund to the earlier purchase at the same merchant', async () => {
    const { repos, ctx, agent, add } = setup();
    await add({
      merchantName: 'Target',
      amountMinor: 5000,
      occurredAt: '2026-09-01T12:00:00.000Z',
    });
    await add({
      id: TX_2,
      merchantName: 'Target',
      amountMinor: 1899,
      occurredAt: '2026-10-01T12:00:00.000Z',
    });
    await add({
      id: TX_3,
      kind: 'refund',
      merchantName: 'Target',
      amountMinor: 1899,
      occurredAt: '2026-10-14T12:00:00.000Z',
    });

    const out = await agent.handle(categorized(TX_3), ctx);

    // The exact-amount purchase wins over the larger, older one.
    expect(out[0]).toEqual({
      type: 'transaction.reconciled',
      payload: { transactionId: TX_3, outcome: 'refund_linked', relatedTransactionId: TX_2 },
    });
    expect(await repos.transactions.get(TX_3)).toMatchObject({
      kind: 'refund',
      linkedTransactionId: TX_2,
    });
    expect(out[1]).toEqual(logged(TX_3));
  });

  it('turns income from a merchant you bought from into a refund', async () => {
    const { repos, ctx, agent, add } = setup();
    await add({
      merchantName: 'Corner Shop',
      amountMinor: 3000,
      occurredAt: '2026-10-01T12:00:00.000Z',
    });
    await add({ id: TX_2, kind: 'income', merchantName: 'Corner Shop', amountMinor: 1000 });

    const out = await agent.handle(categorized(TX_2), ctx);

    expect(out[0]?.payload).toMatchObject({ outcome: 'refund_linked', relatedTransactionId: TX_1 });
    expect((await repos.transactions.get(TX_2))?.kind).toBe('refund');
  });

  it('does not link refunds to old, smaller or already refunded purchases', async () => {
    const { ctx, agent, add } = setup();
    // Too old.
    await add({
      merchantName: 'Target',
      amountMinor: 5000,
      occurredAt: '2026-07-01T12:00:00.000Z',
    });
    // Too small.
    await add({ id: TX_2, merchantName: 'Target', amountMinor: 500 });
    const refund = { kind: 'refund' as const, merchantName: 'Target', amountMinor: 1899 };
    await add({ ...refund, id: TX_3, occurredAt: '2026-10-14T16:00:00.000Z' });

    const out = await agent.handle(categorized(TX_3), ctx);
    expect(out[0]?.payload).toMatchObject({ outcome: 'new' });

    const second = setup();
    await second.add({
      merchantName: 'Target',
      amountMinor: 1899,
      occurredAt: '2026-10-01T12:00:00.000Z',
    });
    await second.add({ ...refund, id: TX_2, linkedTransactionId: TX_1 });
    await second.add({ ...refund, id: TX_3, occurredAt: '2026-10-14T16:00:00.000Z' });
    const out2 = await second.agent.handle(categorized(TX_3), second.ctx);
    expect(out2[0]?.payload).toMatchObject({ outcome: 'new' });
  });

  it('marks card payments as transfers that need no review', async () => {
    const { repos, ctx, agent, add } = setup();
    await add({
      merchantRaw: 'PAYMENT THANK YOU - WEB',
      merchantName: 'Payment Thank You - Web',
      status: 'needs_review',
      kind: 'income',
    });

    const out = await agent.handle(categorized(TX_1), ctx);

    expect(out).toEqual([
      { type: 'transaction.reconciled', payload: { transactionId: TX_1, outcome: 'transfer' } },
      logged(TX_1),
    ]);
    expect(await repos.transactions.get(TX_1)).toMatchObject({
      kind: 'transfer',
      status: 'confirmed',
    });
  });

  it('reports P2P transfers from the Parser as transfers', async () => {
    const { ctx, agent, add } = setup();
    await add({ kind: 'transfer', merchantName: 'Alex Sample', merchantRaw: 'Alex Sample' });

    const out = await agent.handle(categorized(TX_1), ctx);

    expect(out[0]?.payload).toMatchObject({ outcome: 'transfer' });
  });

  it('recognizes transfer descriptors', () => {
    const t = (merchantRaw: string) => looksLikeTransfer({ merchantRaw, merchantName: null });
    expect(t('AUTOPAY 241014')).toBe(true);
    expect(t('Online Transfer to SAV ...1234')).toBe(true);
    expect(t('CAPITAL ONE MOBILE PYMT')).toBe(false);
    expect(t('CREDIT CARD PAYMENT')).toBe(true);
    expect(t('Starbucks')).toBe(false);
    expect(t('Transfer Station Diner')).toBe(false);
  });

  it('emits nothing for a missing transaction', async () => {
    const { ctx, agent } = setup();
    expect(await agent.handle(categorized(TX_1), ctx)).toEqual([]);
  });
});
