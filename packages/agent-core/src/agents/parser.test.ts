import { describe, expect, it } from 'vitest';
import type { AgentContext, EventPayload, StoredEvent } from '@steadily/shared-types';
import { createInMemoryRepos, type InboxItem } from '../ports';
import { createCapturingLogger, createFixedClock, createNoopLlm } from '../testing';
import { createParserAgent, kindFor } from './parser';

// Synthetic data only.
const INBOX_1 = '00000000-0000-4000-8000-0000000000a1';
const EVENT_1 = '00000000-0000-4000-8000-0000000000e1';
const CHASE_SMS =
  'Chase Sapphire (...4821): You made a $25.40 transaction with STARBUCKS STORE 1234 on Oct 14, 2026 at 8:12 AM ET.';

function setup() {
  const repos = createInMemoryRepos();
  const log = createCapturingLogger();
  const clock = createFixedClock('2026-10-15T08:00:00.000Z');
  const ctx: AgentContext = { now: clock, llm: createNoopLlm(), log };
  const agent = createParserAgent({ repos });
  const addInbox = (rawText: string, overrides: Partial<InboxItem> = {}) => {
    const item: InboxItem = {
      id: INBOX_1,
      createdAt: '2026-10-14T15:12:00.000Z',
      expiresAt: '2026-10-21T15:12:00.000Z',
      source: 'ios_sms_shortcut',
      rawText,
      originApp: null,
      originSender: null,
      ...overrides,
    };
    repos.inbox.rows.set(item.id, item);
  };
  return { repos, log, ctx, agent, addInbox };
}

function captured(
  payload: Partial<EventPayload<'transaction.captured'>> = {},
): StoredEvent<'transaction.captured'> {
  return {
    id: EVENT_1,
    type: 'transaction.captured',
    at: '2026-10-15T08:00:00.000Z',
    causationId: null,
    payload: { inboxId: INBOX_1, source: 'ios_sms_shortcut', extracted: {}, ...payload },
  };
}

describe('Parser agent', () => {
  it('parses the inbox text, stores a transaction and discards the inbox item', async () => {
    const { repos, ctx, agent, addInbox } = setup();
    addInbox(CHASE_SMS);

    const out = await agent.handle(captured(), ctx);

    expect(out).toEqual([{ type: 'transaction.parsed', payload: { transactionId: INBOX_1 } }]);
    expect(repos.inbox.rows.size).toBe(0);
    expect(await repos.transactions.get(INBOX_1)).toEqual({
      id: INBOX_1,
      createdAt: '2026-10-15T08:00:00.000Z',
      updatedAt: '2026-10-15T08:00:00.000Z',
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
      accountLast4: '4821',
      issuerId: 'chase',
      txnRef: null,
      note: null,
      linkedTransactionId: null,
    });
  });

  it('lets fields from the event win over the text parse', async () => {
    const { repos, ctx, agent, addInbox } = setup();
    addInbox(CHASE_SMS);

    await agent.handle(
      captured({
        extracted: { amountMinor: 2600, occurredAt: '2026-10-14T15:10:00.000Z', txnRef: 'R1' },
      }),
      ctx,
    );

    const tx = await repos.transactions.get(INBOX_1);
    expect(tx).toMatchObject({
      amountMinor: 2600,
      occurredAt: '2026-10-14T15:10:00.000Z',
      txnRef: 'R1',
      merchantName: 'Starbucks',
      accountLast4: '4821',
    });
  });

  it('uses the native quick category and auto-confirms when confident', async () => {
    const { repos, ctx, agent, addInbox } = setup();
    addInbox(CHASE_SMS);

    await agent.handle(
      captured({
        quickCategory: { categoryId: 'food.coffee', confidence: 0.92, source: 'dictionary' },
      }),
      ctx,
    );

    expect(await repos.transactions.get(INBOX_1)).toMatchObject({
      categoryId: 'food.coffee',
      categoryConfidence: 0.92,
      categorySource: 'dictionary',
      status: 'confirmed',
    });
  });

  it('works from event fields alone when the inbox item is gone', async () => {
    const { repos, ctx, agent } = setup();

    const out = await agent.handle(
      captured({
        source: 'manual',
        extracted: {
          amountMinor: 1200,
          direction: 'debit',
          occurredAt: '2026-10-14T12:00:00.000Z',
          currency: 'USD',
        },
      }),
      ctx,
    );

    expect(out).toHaveLength(1);
    expect(await repos.transactions.get(INBOX_1)).toMatchObject({
      amountMinor: 1200,
      merchantRaw: null,
      merchantName: null,
      source: 'manual',
    });
  });

  it('defaults the currency to USD', async () => {
    const { repos, ctx, agent } = setup();
    await agent.handle(
      captured({
        extracted: { amountMinor: 100, direction: 'debit', occurredAt: '2026-10-14T12:00:00.000Z' },
      }),
      ctx,
    );
    expect((await repos.transactions.get(INBOX_1))?.currency).toBe('USD');
  });

  it('emits parse_failed without raw text when required fields are missing', async () => {
    const { repos, log, ctx, agent, addInbox } = setup();
    const secret = 'Chase: Your one-time code is 482913. SYNTHETIC SECRET';
    addInbox(secret);

    const out = await agent.handle(captured({ extracted: { merchantRaw: 'SECRET SHOP' } }), ctx);

    expect(out).toEqual([
      {
        type: 'transaction.parse_failed',
        payload: {
          inboxId: INBOX_1,
          source: 'ios_sms_shortcut',
          reason: 'missing fields: amount, direction, occurredAt',
        },
      },
    ]);
    expect(repos.inbox.rows.size).toBe(0);
    expect(repos.transactions.rows.size).toBe(0);
    const logged = JSON.stringify(log.entries);
    expect(logged).not.toContain('482913');
    expect(logged).not.toContain('SECRET');
  });

  it('survives an inbox item with an invalid timestamp without leaking text', async () => {
    const { ctx, agent, addInbox } = setup();
    addInbox(CHASE_SMS, { createdAt: 'not a date' });

    const out = await agent.handle(captured(), ctx);

    expect(out[0]?.type).toBe('transaction.parse_failed');
    expect(JSON.stringify(out)).not.toContain('STARBUCKS');
  });

  it('is idempotent: a re-delivered capture emits nothing and inserts nothing', async () => {
    const { repos, ctx, agent, addInbox } = setup();
    addInbox(CHASE_SMS);
    await agent.handle(captured(), ctx);

    const again = await agent.handle(captured(), ctx);

    expect(again).toEqual([]);
    expect(repos.transactions.rows.size).toBe(1);
  });

  it('finishes a capture interrupted after the insert', async () => {
    const { repos, ctx, agent, addInbox } = setup();
    addInbox(CHASE_SMS);
    await agent.handle(captured(), ctx);
    addInbox(CHASE_SMS); // as if the delete never happened

    const again = await agent.handle(captured(), ctx);

    expect(again).toEqual([{ type: 'transaction.parsed', payload: { transactionId: INBOX_1 } }]);
    expect(repos.inbox.rows.size).toBe(0);
    expect(repos.transactions.rows.size).toBe(1);
  });

  it('marks a credit at a known merchant as a refund', async () => {
    const { repos, ctx, agent, addInbox } = setup();
    addInbox('Chase Freedom (...4821): You have a $18.99 refund from TARGET 00012345.');
    await agent.handle(captured(), ctx);
    expect(await repos.transactions.get(INBOX_1)).toMatchObject({
      kind: 'refund',
      merchantName: 'Target',
      amountMinor: 1899,
    });
  });

  it('marks a P2P credit as a transfer', async () => {
    const { repos, ctx, agent, addInbox } = setup();
    addInbox('Alex Sample paid you $45.50 for concert tickets', {
      source: 'android_notification',
    });
    // Push rules need the posting app, so the native fast path supplies the fields.
    await agent.handle(
      captured({
        source: 'android_notification',
        extracted: {
          amountMinor: 4550,
          currency: 'USD',
          direction: 'credit',
          merchantRaw: 'Alex Sample',
          occurredAt: '2026-10-14T15:12:00.000Z',
          issuerId: 'venmo',
        },
      }),
      ctx,
    );
    expect(await repos.transactions.get(INBOX_1)).toMatchObject({ kind: 'transfer' });
  });

  it('derives kind from direction, issuer and merchant', () => {
    expect(kindFor('debit', 'venmo', false)).toBe('expense');
    expect(kindFor('credit', 'chase', true)).toBe('refund');
    expect(kindFor('credit', 'chase', false)).toBe('income');
    expect(kindFor('credit', undefined, false)).toBe('income');
    expect(kindFor('credit', 'cash_app', true)).toBe('transfer');
  });

  it('ignores other event types', async () => {
    const { ctx, agent } = setup();
    const out = await agent.handle(
      {
        id: EVENT_1,
        type: 'transaction.parsed',
        at: '2026-10-15T08:00:00.000Z',
        causationId: null,
        payload: { transactionId: INBOX_1 },
      },
      ctx,
    );
    expect(out).toEqual([]);
  });
});
