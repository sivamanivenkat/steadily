import { describe, expect, it } from 'vitest';
import type { Agent, EventType, NewEvent, StoredEvent } from '@steadily/shared-types';
import { EventBus } from './event-bus';
import { InMemoryEventStore, type EventStore } from './event-store';
import { AgentRuntime, agentCursorName, type AgentRuntimeOptions } from './runtime';
import {
  createCapturingLogger,
  createFixedClock,
  createNoopLlm,
  createSequentialIds,
} from './testing';

// Synthetic data only.
const TXN_1 = '11111111-1111-4111-8111-111111111111';
const TXN_2 = '22222222-2222-4222-8222-222222222222';
const INBOX_1 = '33333333-3333-4333-8333-333333333333';
const SECRET_MERCHANT = 'SYNTHETIC COFFEE SHOP';

function setup(options: Partial<AgentRuntimeOptions> = {}) {
  const store = new InMemoryEventStore();
  const log = createCapturingLogger();
  const clock = createFixedClock();
  const newId = createSequentialIds();
  const runtime = new AgentRuntime({ store, log, clock, newId, llm: createNoopLlm(), ...options });
  return { store, log, clock, runtime, bus: runtime.bus };
}

function captured(merchantRaw = SECRET_MERCHANT): NewEvent<'transaction.captured'> {
  return {
    type: 'transaction.captured',
    payload: {
      inboxId: INBOX_1,
      source: 'android_notification',
      extracted: { amountMinor: 450, currency: 'USD', merchantRaw },
    },
  };
}

function parsed(transactionId: string): NewEvent<'transaction.parsed'> {
  return { type: 'transaction.parsed', payload: { transactionId } };
}

function categorized(
  transactionId: string,
  needsReview: boolean,
): NewEvent<'transaction.categorized'> {
  return {
    type: 'transaction.categorized',
    payload: {
      transactionId,
      categoryId: 'food.coffee',
      confidence: needsReview ? 0.4 : 0.95,
      source: needsReview ? 'classifier' : 'dictionary',
      needsReview,
    },
  };
}

/** Agent that records what it saw and emits whatever `respond` returns. */
function recorder(
  name: string,
  subscribes: EventType[],
  respond: (event: StoredEvent) => NewEvent[] = () => [],
): Agent & { seen: StoredEvent[] } {
  const seen: StoredEvent[] = [];
  return {
    name,
    subscribes,
    seen,
    async handle(event) {
      seen.push(event);
      return respond(event);
    },
  };
}

describe('EventBus', () => {
  it('stamps id, at and causationId from injected sources', async () => {
    const store = new InMemoryEventStore();
    const bus = new EventBus({ store, clock: createFixedClock(), newId: createSequentialIds() });
    const [row] = await bus.publish([parsed(TXN_1)], TXN_2);
    expect(row).toEqual({
      seq: 1,
      event: {
        id: '00000000-0000-4000-8000-000000000001',
        type: 'transaction.parsed',
        at: '2026-10-15T08:00:00.000Z',
        causationId: TXN_2,
        payload: { transactionId: TXN_1 },
      },
    });
  });

  it('defaults to random uuids', async () => {
    const bus = new EventBus({ store: new InMemoryEventStore() });
    const [row] = await bus.publish([parsed(TXN_1)], null);
    expect(row?.event.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects invalid events and stores none of the batch', async () => {
    const store = new InMemoryEventStore();
    const bus = new EventBus({ store });
    const bad = { type: 'transaction.parsed', payload: { transactionId: 'not-a-uuid' } } as const;
    await expect(bus.publish([parsed(TXN_1), bad], null)).rejects.toThrow();
    expect(store.all()).toEqual([]);
  });
});

describe('AgentRuntime', () => {
  it('delivers events in seq order, only to subscribers', async () => {
    const { runtime, bus } = setup();
    const all = recorder('all', ['transaction.parsed', 'transaction.categorized']);
    const parsedOnly = recorder('parsed-only', ['transaction.parsed']);
    runtime.register(all).register(parsedOnly);

    await bus.publish([parsed(TXN_1), categorized(TXN_1, false), parsed(TXN_2)], null);
    await runtime.runUntilIdle();

    expect(all.seen.map((e) => e.type)).toEqual([
      'transaction.parsed',
      'transaction.categorized',
      'transaction.parsed',
    ]);
    expect(parsedOnly.seen.map((e) => e.payload)).toEqual([
      { transactionId: TXN_1 },
      { transactionId: TXN_2 },
    ]);
  });

  it('is idempotent across runs and across runtime restarts', async () => {
    const { runtime, bus, store, log } = setup();
    const agent = recorder('a', ['transaction.parsed'], () => [categorized(TXN_1, false)]);
    runtime.register(agent);

    await bus.publish([parsed(TXN_1)], null);
    expect((await runtime.runUntilIdle()).deliveries).toBe(1);
    expect((await runtime.runUntilIdle()).deliveries).toBe(0);

    // A fresh runtime (app restart) over the same store must not redeliver.
    const restarted = new AgentRuntime({ store, log, llm: createNoopLlm() });
    const again = recorder('a', ['transaction.parsed'], () => [categorized(TXN_1, false)]);
    restarted.register(again);
    expect((await restarted.runUntilIdle()).deliveries).toBe(0);
    expect(again.seen).toEqual([]);
    expect(store.all().filter((r) => r.event.type === 'transaction.categorized')).toHaveLength(1);

    // New events are still picked up.
    await bus.publish([parsed(TXN_2)], null);
    expect((await restarted.runUntilIdle()).deliveries).toBe(1);
  });

  it('chains causation through emitted events within one run', async () => {
    const { runtime, bus, store } = setup();
    runtime
      .register(recorder('parser', ['transaction.captured'], () => [parsed(TXN_1)]))
      .register(recorder('categorizer', ['transaction.parsed'], () => [categorized(TXN_1, true)]))
      .register(
        recorder('notifier', ['transaction.categorized'], () => [
          {
            type: 'notify.request',
            payload: { kind: 'transaction_needs_review', urgency: 'instant', transactionId: TXN_1 },
          },
        ]),
      );

    const [root] = await bus.publish([captured()], null);
    const result = await runtime.runUntilIdle();
    expect(result.succeeded).toBe(3);

    const events = store.all().map((r) => r.event);
    expect(events.map((e) => e.type)).toEqual([
      'transaction.captured',
      'transaction.parsed',
      'transaction.categorized',
      'notify.request',
    ]);
    expect(events[0]?.id).toBe(root?.event.id);
    expect(events[0]?.causationId).toBeNull();
    for (let i = 1; i < events.length; i++) {
      expect(events[i]?.causationId).toBe(events[i - 1]?.id);
    }
  });

  it('isolates a failing agent and gives up after maxAttempts', async () => {
    const { runtime, bus, log } = setup({ maxAttempts: 3 });
    let calls = 0;
    const failing: Agent = {
      name: 'failing',
      subscribes: ['transaction.captured'],
      async handle() {
        calls++;
        throw new TypeError(`boom ${SECRET_MERCHANT}`);
      },
    };
    const healthy = recorder('healthy', ['transaction.captured']);
    runtime.register(failing).register(healthy);

    const [row] = await bus.publish([captured()], null);
    const eventId = row?.event.id;

    const first = await runtime.runUntilIdle();
    expect(first).toMatchObject({ succeeded: 1, failed: 1, skipped: 0 });
    expect(healthy.seen).toHaveLength(1);
    expect(calls).toBe(1);

    await runtime.runUntilIdle();
    const third = await runtime.runUntilIdle();
    expect(third).toMatchObject({ deliveries: 1, failed: 1, skipped: 1 });
    expect(calls).toBe(3);

    // Given up: no further attempts, healthy agent never re-run.
    expect((await runtime.runUntilIdle()).deliveries).toBe(0);
    expect(calls).toBe(3);
    expect(healthy.seen).toHaveLength(1);

    expect(log.entries.map((e) => e.level)).toEqual(['warn', 'warn', 'error']);
    expect(log.entries.at(-1)).toEqual({
      level: 'error',
      message: 'Agent failed 3 times (TypeError); skipping event',
      meta: { agent: 'failing', eventId },
    });
    // Neither payload fields nor error messages leak into logs (D-011).
    expect(JSON.stringify(log.entries)).not.toContain(SECRET_MERCHANT);
  });

  it('does not let a failure on one event block later events for the same agent', async () => {
    const { runtime, bus } = setup();
    const agent = recorder('picky', ['transaction.parsed'], (event) => {
      if (event.type === 'transaction.parsed' && event.payload.transactionId === TXN_1) {
        throw new Error('first fails');
      }
      return [];
    });
    runtime.register(agent);
    await bus.publish([parsed(TXN_1), parsed(TXN_2)], null);
    const result = await runtime.runUntilIdle();
    expect(result).toMatchObject({ succeeded: 1, failed: 1 });
    // Next run retries only the failed one.
    expect((await runtime.runUntilIdle()).deliveries).toBe(1);
  });

  it('stops a runaway event loop at the delivery cap', async () => {
    const { runtime, bus, log } = setup({ maxDeliveriesPerRun: 10 });
    runtime.register(
      recorder('echo', ['transaction.parsed'], (event) =>
        event.type === 'transaction.parsed' ? [parsed(event.payload.transactionId)] : [],
      ),
    );
    await bus.publish([parsed(TXN_1)], null);

    const result = await runtime.runUntilIdle();
    expect(result).toMatchObject({ deliveries: 10, stoppedByLoopGuard: true });
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]?.level).toBe('warn');
    expect(log.entries[0]?.message).toContain('Delivery cap of 10');
  });

  it('rejects invalid emitted events: nothing stored, event retried', async () => {
    const { runtime, bus, store, log } = setup();
    let valid = false;
    runtime.register(
      recorder('bad', ['transaction.parsed'], () => [
        valid
          ? categorized(TXN_1, false)
          : ({
              type: 'transaction.categorized',
              payload: { ...categorized(TXN_1, false).payload, categoryId: 'food.unknown' },
            } as unknown as NewEvent),
      ]),
    );
    const [row] = await bus.publish([parsed(TXN_1)], null);

    const first = await runtime.runUntilIdle();
    expect(first).toMatchObject({ failed: 1, succeeded: 0 });
    expect(store.all()).toHaveLength(1);
    expect(await store.isProcessed('bad', row!.event.id)).toBe(false);
    expect(log.entries[0]).toMatchObject({ level: 'warn', meta: { agent: 'bad' } });
    expect(JSON.stringify(log.entries)).not.toContain('food.unknown');

    valid = true;
    expect((await runtime.runUntilIdle()).succeeded).toBe(1);
    expect(store.all()).toHaveLength(2);
  });

  it('rejects duplicate agent names', () => {
    const { runtime } = setup();
    runtime.register(recorder('x', []));
    expect(() => runtime.register(recorder('x', []))).toThrow();
  });
});

/** Store wrapper that counts calls, to see where a run starts scanning. */
function spyStore(inner: EventStore) {
  const calls = { readAfter: [] as number[], isProcessed: 0 };
  const store: EventStore = {
    append: (events) => inner.append(events),
    readAfter: (seq, limit) => {
      calls.readAfter.push(seq);
      return inner.readAfter(seq, limit);
    },
    isProcessed: (agent, eventId) => {
      calls.isProcessed++;
      return inner.isProcessed(agent, eventId);
    },
    markProcessed: (agent, eventId, at) => inner.markProcessed(agent, eventId, at),
    recordHandled: (record) => inner.recordHandled(record),
    getFailureAttempts: (agent, eventId) => inner.getFailureAttempts!(agent, eventId),
    recordFailure: (failure) => inner.recordFailure!(failure),
    getCursor: (name) => inner.getCursor!(name),
    setCursor: (name, seq, at) => inner.setCursor!(name, seq, at),
  };
  return { store, calls };
}

/** Only the required EventStore methods: no persisted failures or cursors. */
function minimalStore(inner: InMemoryEventStore): EventStore {
  return {
    append: (events) => inner.append(events),
    readAfter: (seq, limit) => inner.readAfter(seq, limit),
    isProcessed: (agent, eventId) => inner.isProcessed(agent, eventId),
    markProcessed: (agent, eventId, at) => inner.markProcessed(agent, eventId, at),
    recordHandled: (record) => inner.recordHandled(record),
  };
}

function failingAgent(name = 'failing'): Agent & { calls: number } {
  const agent = {
    name,
    subscribes: ['transaction.captured'] as EventType[],
    calls: 0,
    async handle(): Promise<NewEvent[]> {
      agent.calls++;
      throw new TypeError(`boom ${SECRET_MERCHANT}`);
    },
  };
  return agent;
}

describe('AgentRuntime restarts', () => {
  it('keeps retry counts across restarts and records only the error name', async () => {
    const { runtime, bus, store, log } = setup({ maxAttempts: 3 });
    runtime.register(failingAgent());
    const [row] = await bus.publish([captured()], null);
    await runtime.runUntilIdle();
    await runtime.runUntilIdle();
    expect(store.allFailures()).toEqual([
      {
        agent: 'failing',
        eventId: row!.event.id,
        attempts: 2,
        errorName: 'TypeError',
        gaveUp: false,
        at: '2026-10-15T08:00:00.000Z',
      },
    ]);

    const restarted = new AgentRuntime({ store, log, llm: createNoopLlm(), maxAttempts: 3 });
    const again = failingAgent();
    restarted.register(again);
    expect(await restarted.runUntilIdle()).toMatchObject({ deliveries: 1, skipped: 1 });
    expect(again.calls).toBe(1);
    expect(store.allFailures()[0]).toMatchObject({ attempts: 3, gaveUp: true });
    expect(await store.isProcessed('failing', row!.event.id)).toBe(true);
    expect(log.entries.at(-1)?.message).toBe('Agent failed 3 times (TypeError); skipping event');
    expect(JSON.stringify(store.allFailures())).not.toContain(SECRET_MERCHANT);
  });

  it('clears the failure record once the agent succeeds', async () => {
    const { runtime, bus, store } = setup();
    let fail = true;
    runtime.register(
      recorder('flaky', ['transaction.parsed'], () => {
        if (fail) throw new Error('flaky');
        return [];
      }),
    );
    await bus.publish([parsed(TXN_1)], null);
    await runtime.runUntilIdle();
    expect(store.allFailures()).toHaveLength(1);
    fail = false;
    expect((await runtime.runUntilIdle()).succeeded).toBe(1);
    expect(store.allFailures()).toEqual([]);
  });

  it('scans from the stored cursor after a restart', async () => {
    const inner = new InMemoryEventStore();
    const { runtime, bus } = setup({ store: inner });
    runtime.register(recorder('a', ['transaction.parsed']));
    await bus.publish([parsed(TXN_1), parsed(TXN_2), categorized(TXN_1, false)], null);
    await runtime.runUntilIdle();
    expect(
      await inner.getCursor(agentCursorName({ name: 'a', subscribes: ['transaction.parsed'] })),
    ).toBe(3);

    const { store, calls } = spyStore(inner);
    const restarted = new AgentRuntime({
      store,
      log: createCapturingLogger(),
      llm: createNoopLlm(),
    });
    restarted.register(recorder('a', ['transaction.parsed']));
    expect((await restarted.runUntilIdle()).deliveries).toBe(0);
    expect(calls.readAfter).toEqual([3]);
    expect(calls.isProcessed).toBe(0);
  });

  it('gives a newly registered agent the full history', async () => {
    const inner = new InMemoryEventStore();
    const { runtime, bus } = setup({ store: inner });
    runtime.register(recorder('a', ['transaction.parsed']));
    await bus.publish([parsed(TXN_1), parsed(TXN_2)], null);
    await runtime.runUntilIdle();

    const restarted = new AgentRuntime({
      store: inner,
      log: createCapturingLogger(),
      llm: createNoopLlm(),
    });
    const a = recorder('a', ['transaction.parsed']);
    const b = recorder('b', ['transaction.parsed']);
    restarted.register(a).register(b);
    expect((await restarted.runUntilIdle()).deliveries).toBe(2);
    expect(a.seen).toEqual([]);
    expect(b.seen).toHaveLength(2);
  });

  it('rescans when an agent subscribes to a new event type', async () => {
    const inner = new InMemoryEventStore();
    const { runtime, bus } = setup({ store: inner });
    runtime.register(recorder('a', ['transaction.parsed']));
    await bus.publish([parsed(TXN_1), categorized(TXN_1, false)], null);
    await runtime.runUntilIdle();

    const restarted = new AgentRuntime({
      store: inner,
      log: createCapturingLogger(),
      llm: createNoopLlm(),
    });
    const a = recorder('a', ['transaction.parsed', 'transaction.categorized']);
    restarted.register(a);
    expect((await restarted.runUntilIdle()).deliveries).toBe(1);
    expect(a.seen.map((e) => e.type)).toEqual(['transaction.categorized']);
  });

  it('does not move the cursor past an event that is still being retried', async () => {
    const inner = new InMemoryEventStore();
    const { runtime, bus } = setup({ store: inner });
    const picky = recorder('picky', ['transaction.parsed'], (event) => {
      if (event.type === 'transaction.parsed' && event.payload.transactionId === TXN_1) {
        throw new Error('first fails');
      }
      return [];
    });
    runtime.register(picky);
    await bus.publish([parsed(TXN_2), parsed(TXN_1), parsed(TXN_2)], null);
    expect(await runtime.runUntilIdle()).toMatchObject({ succeeded: 2, failed: 1 });
    expect(await inner.getCursor(agentCursorName(picky))).toBe(1);

    const restarted = new AgentRuntime({
      store: inner,
      log: createCapturingLogger(),
      llm: createNoopLlm(),
    });
    const again = recorder('picky', ['transaction.parsed']);
    restarted.register(again);
    expect(await restarted.runUntilIdle()).toMatchObject({ deliveries: 1, succeeded: 1 });
    expect(
      again.seen.map((e) => e.type === 'transaction.parsed' && e.payload.transactionId),
    ).toEqual([TXN_1]);
    expect(await inner.getCursor(agentCursorName(picky))).toBe(3);
  });

  it('keeps working with a store that has no failure or cursor support', async () => {
    const inner = new InMemoryEventStore();
    const store = minimalStore(inner);
    const { runtime, bus } = setup({ store, maxAttempts: 2 });
    const agent = failingAgent();
    runtime.register(agent);
    await bus.publish([captured()], null);
    expect((await runtime.runUntilIdle()).skipped).toBe(0);
    expect((await runtime.runUntilIdle()).skipped).toBe(1);
    expect((await runtime.runUntilIdle()).deliveries).toBe(0);
    expect(agent.calls).toBe(2);
    expect(inner.allFailures()).toEqual([]);
  });
});

/**
 * Replay: a small example agent that asks the Notifier to surface
 * categorizations that need review. Events in -> events out.
 */
const reviewNudger: Agent = {
  name: 'review-nudger',
  subscribes: ['transaction.categorized'],
  async handle(event) {
    if (event.type !== 'transaction.categorized' || !event.payload.needsReview) return [];
    return [
      {
        type: 'notify.request',
        payload: {
          kind: 'transaction_needs_review',
          urgency: 'instant',
          transactionId: event.payload.transactionId,
        },
      },
    ];
  },
};

describe('replay: review-nudger', () => {
  it('turns needs-review categorizations into notify requests', async () => {
    const { runtime, bus, store } = setup();
    runtime.register(reviewNudger);

    const input = await bus.publish(
      [categorized(TXN_1, true), categorized(TXN_2, false), categorized(TXN_2, true)],
      null,
    );
    await runtime.runUntilIdle();

    const output = store
      .all()
      .slice(input.length)
      .map(({ event }) => ({
        type: event.type,
        causationId: event.causationId,
        payload: event.payload,
      }));
    expect(output).toEqual([
      {
        type: 'notify.request',
        causationId: input[0]?.event.id,
        payload: { kind: 'transaction_needs_review', urgency: 'instant', transactionId: TXN_1 },
      },
      {
        type: 'notify.request',
        causationId: input[2]?.event.id,
        payload: { kind: 'transaction_needs_review', urgency: 'instant', transactionId: TXN_2 },
      },
    ]);
  });
});

describe('AgentRuntime.tick', () => {
  const checkin: NewEvent = {
    type: 'notify.request',
    payload: { kind: 'weekly_checkin', urgency: 'instant' },
  };

  it('publishes tick output without causation, then delivers it', async () => {
    const { runtime, store } = setup();
    const ticker: Agent = { ...recorder('ticker', []), tick: async () => [checkin] };
    const listener = recorder('listener', ['notify.request']);
    runtime.register(ticker).register(listener);

    const result = await runtime.tick();

    expect(result).toMatchObject({ ticked: 1, published: 1, failed: 0 });
    expect(result.run).toMatchObject({ deliveries: 1, succeeded: 1 });
    expect(store.all().map(({ event }) => [event.type, event.causationId])).toEqual([
      ['notify.request', null],
    ]);
    expect(listener.seen).toHaveLength(1);
  });

  it('isolates a failing or invalid tick and logs only the error name', async () => {
    const { runtime, store, log } = setup();
    const throws: Agent = {
      ...recorder('throws', []),
      tick: async () => {
        throw new TypeError(`boom ${SECRET_MERCHANT}`);
      },
    };
    const invalid: Agent = {
      ...recorder('invalid', []),
      tick: async () => [{ type: 'notify.request', payload: { kind: 'nope' } } as never],
    };
    const ok: Agent = { ...recorder('ok', []), tick: async () => [checkin] };
    runtime.register(throws).register(invalid).register(ok).register(recorder('no-tick', []));

    const result = await runtime.tick();

    expect(result).toMatchObject({ ticked: 3, published: 1, failed: 2 });
    expect(store.all()).toHaveLength(1);
    expect(log.entries.map((e) => [e.level, e.meta?.agent])).toEqual([
      ['warn', 'throws'],
      ['warn', 'invalid'],
    ]);
    expect(JSON.stringify(log.entries)).not.toContain(SECRET_MERCHANT);
  });

  it('delivers events that were already pending', async () => {
    const { runtime, bus } = setup();
    const listener = recorder('listener', ['transaction.parsed']);
    runtime.register(listener);
    await bus.publish([parsed(TXN_1)], null);

    const result = await runtime.tick();

    expect(result).toMatchObject({ ticked: 0, published: 0 });
    expect(listener.seen).toHaveLength(1);
  });
});
