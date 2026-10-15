import type { StoredEvent } from '@steadily/shared-types';

/** A stored event plus its delivery position (`events.seq`). */
export interface SequencedEvent {
  seq: number;
  event: StoredEvent;
}

/** Everything that changes when an agent finishes handling one event. */
export interface HandledRecord {
  agent: string;
  eventId: string;
  /** ISO timestamp written to `processed_events.processed_at`. */
  at: string;
  /** Events the agent emitted, already validated and stamped by the bus. */
  emitted: StoredEvent[];
}

/** One failed delivery of an event to an agent (`failed_events`). */
export interface FailureRecord {
  agent: string;
  eventId: string;
  /** Failed attempts so far, including this one. */
  attempts: number;
  /** The error's `name` only. Messages may echo payload values and are never stored (D-011). */
  errorName: string;
  /** The runtime gave up on this pair; the store also marks it processed, atomically. */
  gaveUp: boolean;
  at: string;
}

/**
 * Persistence for the event bus (D-017). Maps onto the `events`,
 * `processed_events`, `failed_events` and `runtime_cursors` tables in
 * `@steadily/db`; every method is async so a SQLite/Drizzle implementation can
 * back it directly.
 *
 * The failure and cursor methods are optional: without them the runtime keeps
 * retry counts in memory and rescans from seq 0 after a restart.
 */
export interface EventStore {
  /** Appends events in order; seq is assigned by the store and increases monotonically. */
  append(events: StoredEvent[]): Promise<SequencedEvent[]>;
  /** Events with seq > `seq`, ascending, at most `limit` of them. */
  readAfter(seq: number, limit?: number): Promise<SequencedEvent[]>;
  isProcessed(agent: string, eventId: string): Promise<boolean>;
  markProcessed(agent: string, eventId: string, at: string): Promise<void>;
  /**
   * Appends `emitted`, marks the event processed and clears any failure record
   * for the pair in one atomic step, so a crash cannot leave emitted events
   * without the processed marker (which would re-deliver and duplicate them).
   * SQLite: one transaction.
   */
  recordHandled(record: HandledRecord): Promise<void>;

  /** Failed attempts recorded for (agent, event); 0 if none. */
  getFailureAttempts?(agent: string, eventId: string): Promise<number>;
  /** Upserts the failure record; when `gaveUp`, also marks the pair processed in the same step. */
  recordFailure?(failure: FailureRecord): Promise<void>;
  /** Last seq stored under `name`, or null if never set. */
  getCursor?(name: string): Promise<number | null>;
  setCursor?(name: string, seq: number, at: string): Promise<void>;
}

/** Reference implementation for tests and replay. Not persistent. */
export class InMemoryEventStore implements EventStore {
  private readonly rows: SequencedEvent[] = [];
  private readonly ids = new Set<string>();
  private readonly processed = new Map<string, string>();
  private readonly failures = new Map<string, FailureRecord>();
  private readonly cursors = new Map<string, number>();
  private nextSeq = 1;

  async append(events: StoredEvent[]): Promise<SequencedEvent[]> {
    return this.appendSync(events);
  }

  async readAfter(seq: number, limit?: number): Promise<SequencedEvent[]> {
    const after = this.rows.filter((row) => row.seq > seq);
    return limit === undefined ? after : after.slice(0, limit);
  }

  async isProcessed(agent: string, eventId: string): Promise<boolean> {
    return this.processed.has(pairKey(agent, eventId));
  }

  async markProcessed(agent: string, eventId: string, at: string): Promise<void> {
    this.markProcessedSync(agent, eventId, at);
  }

  async recordHandled(record: HandledRecord): Promise<void> {
    this.appendSync(record.emitted);
    this.markProcessedSync(record.agent, record.eventId, record.at);
    this.failures.delete(pairKey(record.agent, record.eventId));
  }

  async getFailureAttempts(agent: string, eventId: string): Promise<number> {
    return this.failures.get(pairKey(agent, eventId))?.attempts ?? 0;
  }

  async recordFailure(failure: FailureRecord): Promise<void> {
    this.failures.set(pairKey(failure.agent, failure.eventId), { ...failure });
    if (failure.gaveUp) this.markProcessedSync(failure.agent, failure.eventId, failure.at);
  }

  async getCursor(name: string): Promise<number | null> {
    return this.cursors.get(name) ?? null;
  }

  async setCursor(name: string, seq: number): Promise<void> {
    this.cursors.set(name, seq);
  }

  /** All events in seq order (test/replay convenience). */
  all(): SequencedEvent[] {
    return [...this.rows];
  }

  /** All failure records (test convenience). */
  allFailures(): FailureRecord[] {
    return [...this.failures.values()].map((failure) => ({ ...failure }));
  }

  private markProcessedSync(agent: string, eventId: string, at: string): void {
    const key = pairKey(agent, eventId);
    if (!this.processed.has(key)) this.processed.set(key, at);
  }

  private appendSync(events: StoredEvent[]): SequencedEvent[] {
    // Mirror the unique index on events.id: reject the whole batch up front.
    const batchIds = new Set<string>();
    for (const event of events) {
      if (this.ids.has(event.id) || batchIds.has(event.id)) {
        throw new Error(`Duplicate event id: ${event.id}`);
      }
      batchIds.add(event.id);
    }
    const appended = events.map((event) => ({ seq: this.nextSeq++, event }));
    for (const row of appended) {
      this.rows.push(row);
      this.ids.add(row.event.id);
    }
    return appended;
  }
}

function pairKey(agent: string, eventId: string): string {
  return `${agent}\u0000${eventId}`;
}
