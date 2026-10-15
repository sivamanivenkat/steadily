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

/**
 * Persistence for the event bus (D-017). Maps onto the `events` and
 * `processed_events` tables in `@steadily/db`; every method is async so a
 * SQLite/Drizzle implementation can back it directly.
 */
export interface EventStore {
  /** Appends events in order; seq is assigned by the store and increases monotonically. */
  append(events: StoredEvent[]): Promise<SequencedEvent[]>;
  /** Events with seq > `seq`, ascending, at most `limit` of them. */
  readAfter(seq: number, limit?: number): Promise<SequencedEvent[]>;
  isProcessed(agent: string, eventId: string): Promise<boolean>;
  markProcessed(agent: string, eventId: string, at: string): Promise<void>;
  /**
   * Appends `emitted` and marks the event processed in one atomic step, so a
   * crash cannot leave emitted events without the processed marker (which
   * would re-deliver and duplicate them). SQLite: one transaction.
   */
  recordHandled(record: HandledRecord): Promise<void>;
}

/** Reference implementation for tests and replay. Not persistent. */
export class InMemoryEventStore implements EventStore {
  private readonly rows: SequencedEvent[] = [];
  private readonly ids = new Set<string>();
  private readonly processed = new Map<string, string>();
  private nextSeq = 1;

  async append(events: StoredEvent[]): Promise<SequencedEvent[]> {
    return this.appendSync(events);
  }

  async readAfter(seq: number, limit?: number): Promise<SequencedEvent[]> {
    const after = this.rows.filter((row) => row.seq > seq);
    return limit === undefined ? after : after.slice(0, limit);
  }

  async isProcessed(agent: string, eventId: string): Promise<boolean> {
    return this.processed.has(processedKey(agent, eventId));
  }

  async markProcessed(agent: string, eventId: string, at: string): Promise<void> {
    const key = processedKey(agent, eventId);
    if (!this.processed.has(key)) this.processed.set(key, at);
  }

  async recordHandled(record: HandledRecord): Promise<void> {
    this.appendSync(record.emitted);
    await this.markProcessed(record.agent, record.eventId, record.at);
  }

  /** All events in seq order (test/replay convenience). */
  all(): SequencedEvent[] {
    return [...this.rows];
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

function processedKey(agent: string, eventId: string): string {
  return `${agent}\u0000${eventId}`;
}
