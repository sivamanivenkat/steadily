/**
 * End-to-end replay: inbox items + `transaction.captured` events in, through
 * Parser -> Categorizer -> Reconciler on the AgentRuntime, final rows and events out.
 * Alert texts come from the shared, synthetic rule-pack fixtures.
 */
import { describe, expect, it } from 'vitest';
import { Fixture, type Fixture as FixtureType } from '@steadily/rule-packs';
import type { EventPayload, LlmPort, NewEvent, StoredEvent } from '@steadily/shared-types';
import capitalOneFixtures from '@steadily/rule-packs/fixtures/capital_one.json';
import chaseFixtures from '@steadily/rule-packs/fixtures/chase.json';
import venmoFixtures from '@steadily/rule-packs/fixtures/venmo.json';
import { InMemoryEventStore } from '../event-store';
import { createInMemoryRepos, type InboxItem } from '../ports';
import { AgentRuntime } from '../runtime';
import {
  createCapturingLogger,
  createFixedClock,
  createNoopLlm,
  createSequentialIds,
} from '../testing';
import { createCategorizerAgent } from './categorizer';
import { createParserAgent } from './parser';
import { createReconcilerAgent } from './reconciler';

const FIXTURES = {
  chase: Fixture.array().parse(chaseFixtures),
  venmo: Fixture.array().parse(venmoFixtures),
  capitalOne: Fixture.array().parse(capitalOneFixtures),
};

function fixture(pack: keyof typeof FIXTURES, name: string): FixtureType {
  const found = FIXTURES[pack].find((f) => f.name === name);
  if (!found) throw new Error(`Missing fixture: ${name}`);
  return found;
}

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const INBOX = {
  starbucksSms: id(0x101),
  starbucksPush: id(0x102),
  amazon: id(0x103),
  chipotle: id(0x104),
  targetPurchase: id(0x105),
  targetRefund: id(0x106),
  venmoPaid: id(0x107),
  venmoReceived: id(0x108),
  otp: id(0x109),
  amazonRefund: id(0x10a),
};

type Capture = {
  inboxId: string;
  rawText: string;
  receivedAt: string;
  source: InboxItem['source'];
  /** What the native fast path already extracted (e.g. push alerts it attributed to an app). */
  extracted?: EventPayload<'transaction.captured'>['extracted'];
  quickCategory?: EventPayload<'transaction.captured'>['quickCategory'];
};

function fromFixture(
  inboxId: string,
  pack: keyof typeof FIXTURES,
  name: string,
  nativeExtracted = false,
): Capture {
  const f = fixture(pack, name);
  return {
    inboxId,
    rawText: f.input.text,
    receivedAt: f.input.receivedAt,
    source: (f.input.source ?? 'share_text') as InboxItem['source'],
    ...(nativeExtracted && f.expected ? { extracted: f.expected } : {}),
  };
}

const CAPTURES: Capture[] = [
  fromFixture(INBOX.starbucksSms, 'chase', 'sms card transaction with last4 and date'),
  {
    // The same purchase, also seen as a push alert two minutes later.
    inboxId: INBOX.starbucksPush,
    rawText: 'You made a $25.40 transaction with STARBUCKS STORE 1234 on your card ending in 4821',
    receivedAt: '2026-10-14T15:14:00.000Z',
    source: 'android_notification',
    extracted: {
      amountMinor: 2540,
      currency: 'USD',
      direction: 'debit',
      merchantRaw: 'STARBUCKS STORE 1234',
      occurredAt: '2026-10-14T15:14:00.000Z',
      accountLast4: '4821',
      issuerId: 'chase',
    },
    quickCategory: { categoryId: 'food.coffee', confidence: 0.92, source: 'dictionary' },
  },
  fromFixture(INBOX.amazon, 'chase', 'sms online transaction with thousands separator'),
  fromFixture(INBOX.chipotle, 'chase', 'multi-line text is normalized'),
  {
    inboxId: INBOX.targetPurchase,
    rawText: 'Chase Freedom (...4821): You made a $18.99 transaction with TARGET 00012345.',
    receivedAt: '2026-10-10T18:00:00.000Z',
    source: 'ios_sms_shortcut',
  },
  fromFixture(INBOX.targetRefund, 'chase', 'sms refund is a credit'),
  fromFixture(INBOX.venmoPaid, 'venmo', 'sms you paid someone'),
  fromFixture(INBOX.venmoReceived, 'venmo', 'push someone paid you is a credit', true),
  fromFixture(INBOX.otp, 'chase', 'negative: one-time code'),
];

function setup(llm: LlmPort = createNoopLlm()) {
  const store = new InMemoryEventStore();
  const repos = createInMemoryRepos();
  const log = createCapturingLogger();
  const clock = createFixedClock('2026-10-15T08:00:00.000Z');
  const runtime = new AgentRuntime({
    store,
    log,
    clock,
    newId: createSequentialIds(),
    llm,
  });
  runtime
    .register(createParserAgent({ repos }))
    .register(createCategorizerAgent({ repos, newId: createSequentialIds(), timeZone: 'UTC' }))
    .register(createReconcilerAgent({ repos }));

  async function capture(captures: Capture[]) {
    const events: NewEvent[] = [];
    for (const c of captures) {
      repos.inbox.rows.set(c.inboxId, {
        id: c.inboxId,
        createdAt: c.receivedAt,
        expiresAt: '2026-10-22T00:00:00.000Z',
        source: c.source,
        rawText: c.rawText,
        originApp: null,
        originSender: null,
      });
      events.push({
        type: 'transaction.captured',
        payload: {
          inboxId: c.inboxId,
          source: c.source,
          extracted: c.extracted ?? {},
          ...(c.quickCategory ? { quickCategory: c.quickCategory } : {}),
        },
      });
    }
    await runtime.bus.publish(events, null);
    return runtime.runUntilIdle();
  }

  const events = () => store.all().map((row) => row.event);
  const ofType = <T extends StoredEvent['type']>(type: T): StoredEvent<T>[] =>
    events().filter((e) => e.type === type) as StoredEvent<T>[];

  return { store, repos, log, runtime, capture, events, ofType };
}

describe('Parser -> Categorizer -> Reconciler replay', () => {
  it('turns captured alerts into reconciled, categorized transactions', async () => {
    const { repos, capture, ofType } = setup();

    const result = await capture(CAPTURES);

    expect(result).toMatchObject({ failed: 0, skipped: 0, stoppedByLoopGuard: false });
    expect(repos.inbox.rows.size).toBe(0);

    const tx = (inboxId: string) => repos.transactions.rows.get(inboxId);
    expect(tx(INBOX.starbucksSms)).toMatchObject({
      merchantName: 'Starbucks',
      amountMinor: 2540,
      kind: 'expense',
      categoryId: 'food.coffee',
      categorySource: 'dictionary',
      status: 'confirmed',
      deletedAt: null,
    });
    expect(tx(INBOX.starbucksPush)).toMatchObject({
      deletedAt: '2026-10-15T08:00:00.000Z',
      linkedTransactionId: INBOX.starbucksSms,
    });
    expect(tx(INBOX.amazon)).toMatchObject({
      merchantName: 'Amazon',
      amountMinor: 123456,
      categoryId: 'shopping.general',
      status: 'needs_review',
    });
    expect(tx(INBOX.chipotle)).toMatchObject({
      merchantName: 'Chipotle',
      categoryId: 'food.dining',
      status: 'confirmed',
    });
    expect(tx(INBOX.targetRefund)).toMatchObject({
      kind: 'refund',
      merchantName: 'Target',
      linkedTransactionId: INBOX.targetPurchase,
    });
    expect(tx(INBOX.venmoPaid)).toMatchObject({
      kind: 'expense',
      merchantName: 'Sam Example',
      categoryId: 'other.general',
      categorySource: 'none',
      status: 'needs_review',
    });
    // D-009: a payment to a person asks with split / rent / gift chips.
    const venmoCategorized = ofType('transaction.categorized').find(
      (e) => e.payload.transactionId === INBOX.venmoPaid,
    );
    expect(venmoCategorized?.payload.suggestions?.map((s) => s.categoryId)).toEqual([
      'food.dining',
      'housing.rent_mortgage',
      'gifts.general',
    ]);
    expect(tx(INBOX.venmoReceived)).toMatchObject({ kind: 'transfer', status: 'confirmed' });
    expect(tx(INBOX.otp)).toBeUndefined();
    expect(repos.transactions.rows.size).toBe(8);

    expect(ofType('transaction.parse_failed').map((e) => e.payload)).toEqual([
      {
        inboxId: INBOX.otp,
        source: 'ios_sms_shortcut',
        reason: 'missing fields: amount, direction, occurredAt',
      },
    ]);

    const outcomes = Object.fromEntries(
      ofType('transaction.reconciled').map((e) => [e.payload.transactionId, e.payload.outcome]),
    );
    expect(outcomes).toEqual({
      [INBOX.starbucksSms]: 'new',
      [INBOX.starbucksPush]: 'duplicate',
      [INBOX.amazon]: 'new',
      [INBOX.chipotle]: 'new',
      [INBOX.targetPurchase]: 'new',
      [INBOX.targetRefund]: 'refund_linked',
      [INBOX.venmoPaid]: 'new',
      [INBOX.venmoReceived]: 'transfer',
    });

    const notifications = ofType('notify.request').map((e) => [
      e.payload.transactionId,
      e.payload.kind,
      e.payload.urgency,
    ]);
    expect(notifications).toEqual(
      expect.arrayContaining([
        [INBOX.starbucksSms, 'transaction_logged', 'summary'],
        [INBOX.amazon, 'transaction_needs_review', 'instant'],
        [INBOX.chipotle, 'transaction_logged', 'summary'],
        [INBOX.targetPurchase, 'transaction_needs_review', 'instant'],
        [INBOX.venmoPaid, 'transaction_needs_review', 'instant'],
        [INBOX.venmoReceived, 'transaction_logged', 'summary'],
      ]),
    );
    // One per surviving transaction; the duplicate is never announced.
    expect(notifications).toHaveLength(7);
    expect(notifications.some(([txId]) => txId === INBOX.starbucksPush)).toBe(false);
  });

  it('learns from a correction and applies it to the next capture', async () => {
    const { repos, runtime, capture, ofType } = setup();
    await capture(CAPTURES);

    await runtime.bus.publish(
      [
        {
          type: 'transaction.user_corrected',
          payload: {
            transactionId: INBOX.amazon,
            previousCategoryId: 'shopping.general',
            categoryId: 'food.groceries',
            applyToSimilar: true,
          },
        },
      ],
      null,
    );
    await runtime.runUntilIdle();
    expect(repos.transactions.rows.get(INBOX.amazon)).toMatchObject({
      categoryId: 'food.groceries',
      categorySource: 'user',
      status: 'confirmed',
    });

    await capture([fromFixture(INBOX.amazonRefund, 'capitalOne', 'sms refund is a credit')]);

    expect(repos.transactions.rows.get(INBOX.amazonRefund)).toMatchObject({
      kind: 'refund',
      merchantName: 'Amazon',
      categoryId: 'food.groceries',
      categorySource: 'user_rule',
      status: 'confirmed',
      linkedTransactionId: INBOX.amazon,
    });
    expect(ofType('transaction.reconciled').at(-1)?.payload).toEqual({
      transactionId: INBOX.amazonRefund,
      outcome: 'refund_linked',
      relatedTransactionId: INBOX.amazon,
    });
  });

  it('asks instantly about a P2P payment even when the LLM is confident', async () => {
    const llm: LlmPort = {
      tier: async () => 'on_device',
      chooseCategory: async () => ({ categoryId: 'gifts.general', confidence: 0.95 }),
    };
    const { repos, capture, ofType } = setup(llm);

    await capture([fromFixture(INBOX.venmoPaid, 'venmo', 'sms you paid someone')]);

    expect(repos.transactions.rows.get(INBOX.venmoPaid)).toMatchObject({
      categoryId: 'gifts.general',
      status: 'needs_review',
    });
    expect(ofType('notify.request').map((e) => e.payload)).toEqual([
      { kind: 'transaction_needs_review', urgency: 'instant', transactionId: INBOX.venmoPaid },
    ]);
  });

  it('is deterministic and idempotent on replay', async () => {
    const first = setup();
    await first.capture(CAPTURES);
    const again = await first.runtime.runUntilIdle();
    expect(again.deliveries).toBe(0);

    const second = setup();
    await second.capture(CAPTURES);
    expect(second.events()).toEqual(first.events());
    expect([...second.repos.transactions.rows.values()]).toEqual([
      ...first.repos.transactions.rows.values(),
    ]);
  });

  it('never puts inbox raw text into events or logs', async () => {
    const { capture, events, log } = setup();
    await capture(CAPTURES);

    const stored = JSON.stringify(events());
    const logged = JSON.stringify(log.entries);
    for (const { rawText } of CAPTURES) {
      expect(stored).not.toContain(rawText);
      expect(logged).not.toContain(rawText);
    }
    // Fragments that exist only in the raw texts (notes, codes, alert wording). Extracted
    // fields such as merchantRaw may legitimately ride on capture events.
    for (const fragment of ['pizza', 'concert', '482913', 'one-time code', 'You made a']) {
      expect(stored).not.toContain(fragment);
      expect(logged).not.toContain(fragment);
    }
  });
});
