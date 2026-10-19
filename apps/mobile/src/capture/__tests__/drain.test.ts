import { EventBus } from '@steadily/agent-core';
import { createRepos, events, inbox, SqliteEventStore } from '@steadily/db';
import { createTestDb, type NodeDb } from '@steadily/db/node';
import type { StoredEvent } from '@steadily/shared-types';
import { eq } from 'drizzle-orm';

import { createAppLogger, createAppRuntime } from '../../data/runtime';
import { drainPendingCaptures, readDrainMetrics, type PendingCaptureStore } from '../drain';
import { getPendingCaptureStore } from '../index';

const NOW = new Date('2026-10-15T16:30:00.000Z');
const newId = () => globalThis.crypto.randomUUID();

/** Synthetic alert text. It must never appear in the event log. */
const SENTINEL = 'SENTINEL alert text card 9999 balance';

const EXTRACTED = {
  amountMinor: 525,
  currency: 'USD',
  direction: 'debit',
  merchantRaw: 'SQ *BLUE BOTTLE COFFEE',
  occurredAt: '2026-10-15T16:29:00.000Z',
  accountLast4: '1234',
  issuerId: 'chase',
};

/** A staged record as the Kotlin fast path writes it. Synthetic merchants and card endings. */
function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    id: newId(),
    source: 'android_notification',
    capturedAt: NOW.toISOString(),
    extracted: EXTRACTED,
    merchantName: 'Blue Bottle Coffee',
    quickCategory: { categoryId: 'food.coffee', confidence: 0.95, source: 'dictionary' },
    ...overrides,
  };
}

/** In-memory stand-in for the native staging store, oldest first. */
class FakeStore implements PendingCaptureStore {
  readonly records = new Map<string, string>();
  ackCalls: string[][] = [];
  failNextAck = false;

  add(...items: Array<Record<string, unknown> | string>): string[] {
    return items.map((item) => {
      const json = typeof item === 'string' ? item : JSON.stringify(item);
      const id = typeof item === 'string' ? newId() : String(item.id);
      this.records.set(id, json);
      return id;
    });
  }

  async peekRaw(limit: number): Promise<readonly string[]> {
    return [...this.records.values()].slice(0, limit);
  }

  async acknowledge(ids: readonly string[]): Promise<number> {
    this.ackCalls.push([...ids]);
    if (this.failNextAck) {
      this.failNextAck = false;
      throw new Error('ack failed');
    }
    let removed = 0;
    for (const id of ids) if (this.records.delete(id)) removed += 1;
    return removed;
  }
}

function setup(db: NodeDb = createTestDb().db) {
  const app = createAppRuntime(db, { newId, clock: () => NOW, log: createAppLogger(false) });
  return { db, ...app };
}

function capturedEvents(db: NodeDb): StoredEvent<'transaction.captured'>[] {
  return db
    .select()
    .from(events)
    .where(eq(events.type, 'transaction.captured'))
    .all() as unknown as StoredEvent<'transaction.captured'>[];
}

describe('drainPendingCaptures', () => {
  it('writes each record as a captured event and runs it through the pipeline', async () => {
    const { db, runtime, repos } = setup();
    const store = new FakeStore();
    const [a, b] = store.add(
      record(),
      record({ extracted: { ...EXTRACTED, amountMinor: 4_000, merchantRaw: 'ZQX 991' } }),
    );

    const result = await drainPendingCaptures({ store, db, runtime, now: () => NOW });

    expect(result).toEqual({
      written: 2,
      duplicates: 0,
      invalid: 0,
      unreadable: 0,
      failed: 0,
      acknowledged: 2,
    });
    expect(store.records.size).toBe(0);
    // The record id is the event id and the inbox id, so the transaction id too.
    expect(capturedEvents(db).map((e) => e.id)).toEqual([a, b]);
    const coffee = await repos.transactions.get(a!);
    expect(coffee).toMatchObject({
      amountMinor: 525,
      categoryId: 'food.coffee',
      status: 'confirmed',
      accountLast4: '1234',
      source: 'android_notification',
    });
    expect(await repos.transactions.get(b!)).toMatchObject({ amountMinor: 4_000 });
    // No inbox rows: staged records hold no raw text.
    expect(db.select().from(inbox).all()).toEqual([]);
  });

  it('does not duplicate a record seen again after a failed acknowledgement', async () => {
    const { db, runtime } = setup();
    const store = new FakeStore();
    const [id] = store.add(record());
    store.failNextAck = true;

    const first = await drainPendingCaptures({ store, db, runtime });
    expect(first).toMatchObject({ written: 1, acknowledged: 0 });
    expect(store.records.size).toBe(1);

    const replay = await drainPendingCaptures({ store, db, runtime });
    expect(replay).toMatchObject({ written: 0, duplicates: 1, acknowledged: 1 });
    expect(store.records.size).toBe(0);
    expect(capturedEvents(db)).toHaveLength(1);
    const all = await createRepos(db).transactions.listBetween(
      '2026-10-01T00:00:00.000Z',
      '2026-11-01T00:00:00.000Z',
    );
    expect(all.map((t) => t.id)).toEqual([id]);
  });

  it('finishes a capture whose process died after the write, on the next launch', async () => {
    const { db } = setup();
    const store = new FakeStore();
    const [id] = store.add(record());
    store.failNextAck = true;
    // The process dies after the event is stored: no acknowledgement, agents never ran.
    const dying = setup(db).runtime;
    await drainPendingCaptures({
      store,
      db,
      runtime: { bus: dying.bus, runUntilIdle: async () => ({}) as never },
    });
    expect(await createRepos(db).transactions.get(id!)).toBeNull();

    // A new runtime over the same database, like the next process start.
    const next = setup(db);
    const result = await drainPendingCaptures({ store, db, runtime: next.runtime });
    expect(result).toMatchObject({ written: 0, duplicates: 1, acknowledged: 1 });
    expect(capturedEvents(db)).toHaveLength(1);
    expect(await next.repos.transactions.get(id!)).toMatchObject({ amountMinor: 525 });
  });

  it('acknowledges invalid records, counts them, and keeps unreadable ones', async () => {
    const { db, runtime } = setup();
    const store = new FakeStore();
    const [badId] = store.add(record({ extracted: { amountMinor: -1 } }));
    const [unreadable] = store.add('{not json');
    const [noId] = store.add(JSON.stringify({ v: 1, id: 'nope' }));
    const [good] = store.add(record());

    const result = await drainPendingCaptures({ store, db, runtime, now: () => NOW });

    expect(result).toMatchObject({ written: 1, invalid: 1, unreadable: 2, acknowledged: 2 });
    expect(store.ackCalls).toEqual([[badId, good]]);
    expect([...store.records.keys()]).toEqual([unreadable, noId]);
    expect(capturedEvents(db).map((e) => e.id)).toEqual([good]);
    expect(readDrainMetrics(db)).toEqual({ invalidDropped: 1, unreadableSeen: 2 });

    await drainPendingCaptures({ store, db, runtime, now: () => NOW });
    expect(readDrainMetrics(db)).toEqual({ invalidDropped: 1, unreadableSeen: 4 });
  });

  it('leaves records whose write failed unacknowledged and stops the run', async () => {
    const { db, runtime } = setup();
    const store = new FakeStore();
    const [first, second, third] = store.add(record(), record(), record());

    class FailingStore extends SqliteEventStore {
      override async append(batch: StoredEvent[]) {
        if (batch.some((event) => event.id === second)) throw new Error('disk full');
        return super.append(batch);
      }
    }
    const bus = new EventBus({ store: new FailingStore(db), newId, clock: () => NOW });
    const result = await drainPendingCaptures({
      store,
      db,
      runtime: { bus, runUntilIdle: () => runtime.runUntilIdle() },
    });

    expect(result).toMatchObject({ written: 2, failed: 1, acknowledged: 2 });
    expect(store.ackCalls).toEqual([[first, third]]);
    expect([...store.records.keys()]).toEqual([second]);

    // The next run, with a healthy database, picks it up.
    const retry = await drainPendingCaptures({ store, db, runtime });
    expect(retry).toMatchObject({ written: 1, failed: 0 });
    expect(store.records.size).toBe(0);
  });

  it('loops in batches until empty, bounded per run', async () => {
    const { db, runtime } = setup();
    const store = new FakeStore();
    for (let i = 0; i < 12; i++) store.add(record());

    const capped = await drainPendingCaptures({ store, db, runtime, batchSize: 5, maxPerRun: 7 });
    expect(capped).toMatchObject({ written: 7, acknowledged: 7 });
    expect(store.ackCalls.map((ids) => ids.length)).toEqual([5, 2]);
    expect(store.records.size).toBe(5);

    const rest = await drainPendingCaptures({ store, db, runtime, batchSize: 5 });
    expect(rest).toMatchObject({ written: 5 });
    expect(store.records.size).toBe(0);
  });

  it('serializes concurrent runs without double writes', async () => {
    const { db, runtime } = setup();
    const store = new FakeStore();
    store.add(record(), record(), record());

    const results = await Promise.all([
      drainPendingCaptures({ store, db, runtime }),
      drainPendingCaptures({ store, db, runtime }),
      drainPendingCaptures({ store, db, runtime }),
    ]);

    // Calls made while a run is waiting share it.
    expect(results[1]).toBe(results[0]);
    expect(results[0]).toMatchObject({ written: 3 });
    expect(capturedEvents(db)).toHaveLength(3);
  });

  it('never writes alert text or unknown fields into events', async () => {
    const { db, runtime } = setup();
    const store = new FakeStore();
    store.add(record({ text: SENTINEL, title: SENTINEL, rawText: SENTINEL }));

    await drainPendingCaptures({ store, db, runtime });

    const rows = db.select().from(events).all();
    expect(rows.length).toBeGreaterThan(1);
    expect(JSON.stringify(rows)).not.toContain('SENTINEL');
    const [captured] = capturedEvents(db);
    expect(Object.keys(captured!.payload).sort()).toEqual([
      'extracted',
      'inboxId',
      'quickCategory',
      'source',
    ]);
  });

  it('is a no-op without the native module (iOS, web, Jest)', async () => {
    const { db, runtime } = setup();
    expect(getPendingCaptureStore()).toBeNull();
    const result = await drainPendingCaptures({ store: getPendingCaptureStore(), db, runtime });
    expect(result).toEqual({
      written: 0,
      duplicates: 0,
      invalid: 0,
      unreadable: 0,
      failed: 0,
      acknowledged: 0,
    });
    expect(db.select().from(events).all()).toEqual([]);
  });
});
