/**
 * SQLite event bus storage (D-017) over the events, processed_events,
 * failed_events and runtime_cursors tables.
 */
import { and, asc, eq, gt } from 'drizzle-orm';
import type {
  EventStore,
  FailureRecord,
  HandledRecord,
  SequencedEvent,
} from '@steadily/agent-core';
import { parseStoredEvent, type StoredEvent } from '@steadily/shared-types';
import type { SteadilyDb } from './client';
import { events, failedEvents, processedEvents, runtimeCursors } from './schema';

type EventRow = typeof events.$inferSelect;
/** The outer db or a transaction handle; both expose the same sync query API. */
type Executor = Pick<SteadilyDb, 'select' | 'insert' | 'update' | 'delete'>;

export class SqliteEventStore implements EventStore {
  constructor(private readonly db: SteadilyDb) {}

  async append(batch: StoredEvent[]): Promise<SequencedEvent[]> {
    if (batch.length === 0) return [];
    return this.db.transaction((tx) => appendRows(tx, batch));
  }

  /**
   * Rows are validated with `parseStoredEvent`. An invalid row throws an error
   * naming only its seq (never payload values, D-011).
   */
  async readAfter(seq: number, limit?: number): Promise<SequencedEvent[]> {
    const query = this.db.select().from(events).where(gt(events.seq, seq)).orderBy(asc(events.seq));
    const rows = limit === undefined ? query.all() : query.limit(limit).all();
    return rows.map(toSequencedEvent);
  }

  async isProcessed(agent: string, eventId: string): Promise<boolean> {
    const row = this.db
      .select({ agent: processedEvents.agent })
      .from(processedEvents)
      .where(and(eq(processedEvents.agent, agent), eq(processedEvents.eventId, eventId)))
      .get();
    return row !== undefined;
  }

  async markProcessed(agent: string, eventId: string, at: string): Promise<void> {
    markProcessedRow(this.db, agent, eventId, at);
  }

  async recordHandled(record: HandledRecord): Promise<void> {
    this.db.transaction((tx) => {
      appendRows(tx, record.emitted);
      markProcessedRow(tx, record.agent, record.eventId, record.at);
      tx.delete(failedEvents)
        .where(and(eq(failedEvents.agent, record.agent), eq(failedEvents.eventId, record.eventId)))
        .run();
    });
  }

  async getFailureAttempts(agent: string, eventId: string): Promise<number> {
    const row = this.db
      .select({ attempts: failedEvents.attempts })
      .from(failedEvents)
      .where(and(eq(failedEvents.agent, agent), eq(failedEvents.eventId, eventId)))
      .get();
    return row?.attempts ?? 0;
  }

  async recordFailure(failure: FailureRecord): Promise<void> {
    const values = {
      agent: failure.agent,
      eventId: failure.eventId,
      attempts: failure.attempts,
      lastErrorName: failure.errorName,
      gaveUp: failure.gaveUp,
      updatedAt: failure.at,
    };
    this.db.transaction((tx) => {
      tx.insert(failedEvents)
        .values(values)
        .onConflictDoUpdate({
          target: [failedEvents.agent, failedEvents.eventId],
          set: {
            attempts: values.attempts,
            lastErrorName: values.lastErrorName,
            gaveUp: values.gaveUp,
            updatedAt: values.updatedAt,
          },
        })
        .run();
      if (failure.gaveUp) markProcessedRow(tx, failure.agent, failure.eventId, failure.at);
    });
  }

  async getCursor(name: string): Promise<number | null> {
    const row = this.db
      .select({ seq: runtimeCursors.seq })
      .from(runtimeCursors)
      .where(eq(runtimeCursors.name, name))
      .get();
    return row?.seq ?? null;
  }

  async setCursor(name: string, seq: number, at: string): Promise<void> {
    this.db
      .insert(runtimeCursors)
      .values({ name, seq, updatedAt: at })
      .onConflictDoUpdate({ target: runtimeCursors.name, set: { seq, updatedAt: at } })
      .run();
  }
}

/** Inserts in order; the unique index on events.id rejects duplicates (and the transaction). */
function appendRows(tx: Executor, batch: StoredEvent[]): SequencedEvent[] {
  return batch.map((event) => {
    const row = tx
      .insert(events)
      .values({
        id: event.id,
        type: event.type,
        at: event.at,
        causationId: event.causationId,
        payload: event.payload,
      })
      .returning({ seq: events.seq })
      .get();
    if (!row) throw new Error('Event insert returned no seq');
    return { seq: row.seq, event };
  });
}

function markProcessedRow(tx: Executor, agent: string, eventId: string, at: string): void {
  tx.insert(processedEvents)
    .values({ agent, eventId, processedAt: at })
    .onConflictDoNothing()
    .run();
}

function toSequencedEvent(row: EventRow): SequencedEvent {
  try {
    return {
      seq: row.seq,
      event: parseStoredEvent({
        id: row.id,
        type: row.type,
        at: row.at,
        causationId: row.causationId,
        payload: row.payload,
      }),
    };
  } catch {
    throw new Error(`Invalid stored event at seq ${row.seq}`);
  }
}
