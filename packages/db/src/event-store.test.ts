import { describe, expect, it } from 'vitest';
import {
  AgentRuntime,
  InMemoryEventStore,
  agentCursorName,
  createCapturingLogger,
  createFixedClock,
  createNoopLlm,
  createSequentialIds,
  type EventStore,
} from '@steadily/agent-core';
import type { Agent, NewEvent, StoredEvent } from '@steadily/shared-types';
import { SqliteEventStore } from './event-store';
import { createTestDb } from './node';
import * as schema from './schema';

// Synthetic data only.
const TXN = '11111111-1111-4111-8111-111111111111';
const INBOX = '33333333-3333-4333-8333-333333333333';
const SECRET_MERCHANT = 'SYNTHETIC COFFEE SHOP';
const AT = '2026-10-15T08:00:00.000Z';
const eid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

function parsedEvent(n: number, causationId: string | null = null): StoredEvent {
  return {
    id: eid(n),
    type: 'transaction.parsed',
    at: AT,
    causationId,
    payload: { transactionId: TXN },
  };
}

function capturedEvent(n: number): StoredEvent {
  return {
    id: eid(n),
    type: 'transaction.captured',
    at: AT,
    causationId: null,
    payload: {
      inboxId: INBOX,
      source: 'android_notification',
      extracted: { amountMinor: 450, currency: 'USD', merchantRaw: SECRET_MERCHANT },
      quickCategory: { categoryId: 'food.coffee', confidence: 0.9, source: 'dictionary' },
    },
  };
}

type Factory = () => { store: EventStore; reopen: () => EventStore };

const factories: [string, Factory][] = [
  [
    'InMemoryEventStore',
    () => {
      const store = new InMemoryEventStore();
      return { store, reopen: () => store };
    },
  ],
  [
    'SqliteEventStore',
    () => {
      const { db } = createTestDb();
      return { store: new SqliteEventStore(db), reopen: () => new SqliteEventStore(db) };
    },
  ],
];

describe.each(factories)('EventStore behaviour: %s', (_name, factory) => {
  it('appends in order with increasing seq and round-trips events', async () => {
    const { store } = factory();
    expect(await store.append([])).toEqual([]);
    const first = await store.append([capturedEvent(1), parsedEvent(2, eid(1))]);
    const second = await store.append([parsedEvent(3)]);
    expect(first.map((r) => r.seq)).toEqual([1, 2]);
    expect(second.map((r) => r.seq)).toEqual([3]);
    expect(await store.readAfter(0)).toEqual([
      { seq: 1, event: capturedEvent(1) },
      { seq: 2, event: parsedEvent(2, eid(1)) },
      { seq: 3, event: parsedEvent(3) },
    ]);
  });

  it('reads after a seq with an optional limit', async () => {
    const { store } = factory();
    await store.append([parsedEvent(1), parsedEvent(2), parsedEvent(3)]);
    expect((await store.readAfter(1)).map((r) => r.seq)).toEqual([2, 3]);
    expect((await store.readAfter(0, 2)).map((r) => r.seq)).toEqual([1, 2]);
    expect(await store.readAfter(3)).toEqual([]);
  });

  it('rejects a batch containing a duplicate id and stores none of it', async () => {
    const { store } = factory();
    await store.append([parsedEvent(1)]);
    await expect(store.append([parsedEvent(2), parsedEvent(1)])).rejects.toThrow();
    await expect(store.append([parsedEvent(3), parsedEvent(3)])).rejects.toThrow();
    expect((await store.readAfter(0)).map((r) => r.event.id)).toEqual([eid(1)]);
  });

  it('marks events processed per agent, idempotently', async () => {
    const { store } = factory();
    expect(await store.isProcessed('a', eid(1))).toBe(false);
    await store.markProcessed('a', eid(1), AT);
    await store.markProcessed('a', eid(1), AT);
    expect(await store.isProcessed('a', eid(1))).toBe(true);
    expect(await store.isProcessed('b', eid(1))).toBe(false);
  });

  it('recordHandled appends emitted events, marks processed and clears failures', async () => {
    const { store } = factory();
    await store.append([parsedEvent(1)]);
    await store.recordFailure!({
      agent: 'a',
      eventId: eid(1),
      attempts: 1,
      errorName: 'TypeError',
      gaveUp: false,
      at: AT,
    });
    await store.recordHandled({
      agent: 'a',
      eventId: eid(1),
      at: AT,
      emitted: [parsedEvent(2, eid(1)), parsedEvent(3, eid(1))],
    });
    expect((await store.readAfter(1)).map((r) => [r.seq, r.event.id])).toEqual([
      [2, eid(2)],
      [3, eid(3)],
    ]);
    expect(await store.isProcessed('a', eid(1))).toBe(true);
    expect(await store.getFailureAttempts!('a', eid(1))).toBe(0);
  });

  it('recordHandled is atomic: a bad emitted batch leaves no trace', async () => {
    const { store } = factory();
    await store.append([parsedEvent(1)]);
    await expect(
      store.recordHandled({
        agent: 'a',
        eventId: eid(1),
        at: AT,
        emitted: [parsedEvent(2), parsedEvent(1)],
      }),
    ).rejects.toThrow();
    expect((await store.readAfter(0)).map((r) => r.event.id)).toEqual([eid(1)]);
    expect(await store.isProcessed('a', eid(1))).toBe(false);
  });

  it('records failures and marks given-up pairs processed', async () => {
    const { store } = factory();
    expect(await store.getFailureAttempts!('a', eid(1))).toBe(0);
    const failure = {
      agent: 'a',
      eventId: eid(1),
      attempts: 1,
      errorName: 'TypeError',
      gaveUp: false,
      at: AT,
    };
    await store.recordFailure!(failure);
    expect(await store.getFailureAttempts!('a', eid(1))).toBe(1);
    expect(await store.isProcessed('a', eid(1))).toBe(false);
    await store.recordFailure!({ ...failure, attempts: 2, gaveUp: true });
    expect(await store.getFailureAttempts!('a', eid(1))).toBe(2);
    expect(await store.isProcessed('a', eid(1))).toBe(true);
    expect(await store.getFailureAttempts!('b', eid(1))).toBe(0);
  });

  it('stores cursors by name', async () => {
    const { store } = factory();
    expect(await store.getCursor!('x')).toBeNull();
    await store.setCursor!('x', 4, AT);
    await store.setCursor!('x', 7, AT);
    await store.setCursor!('y', 1, AT);
    expect(await store.getCursor!('x')).toBe(7);
    expect(await store.getCursor!('y')).toBe(1);
  });

  it('keeps everything when reopened', async () => {
    const { store, reopen } = factory();
    await store.append([parsedEvent(1)]);
    await store.markProcessed('a', eid(1), AT);
    await store.setCursor!('x', 1, AT);
    await store.recordFailure!({
      agent: 'b',
      eventId: eid(1),
      attempts: 2,
      errorName: 'Error',
      gaveUp: false,
      at: AT,
    });
    const again = reopen();
    expect((await again.readAfter(0)).map((r) => r.event)).toEqual([parsedEvent(1)]);
    expect(await again.isProcessed('a', eid(1))).toBe(true);
    expect(await again.getCursor!('x')).toBe(1);
    expect(await again.getFailureAttempts!('b', eid(1))).toBe(2);
    const [next] = await again.append([parsedEvent(2)]);
    expect(next?.seq).toBe(2);
  });
});

describe('SqliteEventStore specifics', () => {
  it('stores only the error name in failed_events', async () => {
    const { db } = createTestDb();
    const store = new SqliteEventStore(db);
    await store.recordFailure({
      agent: 'a',
      eventId: eid(1),
      attempts: 3,
      errorName: 'RangeError',
      gaveUp: true,
      at: AT,
    });
    expect(db.select().from(schema.failedEvents).all()).toEqual([
      {
        agent: 'a',
        eventId: eid(1),
        attempts: 3,
        lastErrorName: 'RangeError',
        gaveUp: true,
        updatedAt: AT,
      },
    ]);
  });

  it('rejects invalid stored rows without echoing their payload', async () => {
    const { db } = createTestDb();
    db.insert(schema.events)
      .values({
        id: eid(1),
        type: 'transaction.parsed',
        at: AT,
        causationId: null,
        payload: { transactionId: SECRET_MERCHANT },
      })
      .run();
    const store = new SqliteEventStore(db);
    const error = await store.readAfter(0).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Invalid stored event at seq 1');
  });

  it('rolls back the processed marker when the emitted insert fails mid-batch', async () => {
    const { db } = createTestDb();
    const store = new SqliteEventStore(db);
    await store.append([parsedEvent(1), parsedEvent(9)]);
    await expect(
      store.recordHandled({
        agent: 'a',
        eventId: eid(1),
        at: AT,
        // eid(2) inserts fine before eid(9) collides with an existing row.
        emitted: [parsedEvent(2), parsedEvent(9)],
      }),
    ).rejects.toThrow();
    expect(db.select().from(schema.events).all()).toHaveLength(2);
    expect(db.select().from(schema.processedEvents).all()).toEqual([]);
  });
});

describe('AgentRuntime on SqliteEventStore', () => {
  function captured(): NewEvent<'transaction.captured'> {
    return {
      type: 'transaction.captured',
      payload: {
        inboxId: INBOX,
        source: 'android_notification',
        extracted: { amountMinor: 450, currency: 'USD', merchantRaw: SECRET_MERCHANT },
      },
    };
  }

  it('delivers, persists failures and resumes from the cursor across restarts', async () => {
    const { db } = createTestDb();
    const clock = createFixedClock();
    const newId = createSequentialIds();
    const start = () =>
      new AgentRuntime({
        store: new SqliteEventStore(db),
        log: createCapturingLogger(),
        llm: createNoopLlm(),
        clock,
        newId,
        maxAttempts: 2,
      });

    let parserCalls = 0;
    const parser: Agent = {
      name: 'parser',
      subscribes: ['transaction.captured'],
      async handle() {
        parserCalls++;
        return [{ type: 'transaction.parsed', payload: { transactionId: TXN } }];
      },
    };
    let failCalls = 0;
    const failing: Agent = {
      name: 'failing',
      subscribes: ['transaction.parsed'],
      async handle() {
        failCalls++;
        throw new TypeError(`boom ${SECRET_MERCHANT}`);
      },
    };

    const first = start().register(parser).register(failing);
    await first.bus.publish([captured()], null);
    expect(await first.runUntilIdle()).toMatchObject({ succeeded: 1, failed: 1, skipped: 0 });

    // Restart: the parser is not re-run, the failing agent's count carries over.
    const second = start().register(parser).register(failing);
    expect(await second.runUntilIdle()).toMatchObject({ deliveries: 1, skipped: 1 });
    expect(parserCalls).toBe(1);
    expect(failCalls).toBe(2);
    expect(db.select().from(schema.failedEvents).all()).toMatchObject([
      { agent: 'failing', attempts: 2, lastErrorName: 'TypeError', gaveUp: true },
    ]);
    expect(JSON.stringify(db.select().from(schema.failedEvents).all())).not.toContain(
      SECRET_MERCHANT,
    );
    expect(db.select().from(schema.runtimeCursors).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: agentCursorName(parser), seq: 2 }),
        expect.objectContaining({ name: agentCursorName(failing), seq: 2 }),
      ]),
    );

    // Third start: nothing left to do.
    const third = start().register(parser).register(failing);
    expect((await third.runUntilIdle()).deliveries).toBe(0);
  });
});
