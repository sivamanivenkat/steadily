/**
 * Moves captures staged by the Android fast path into the agent pipeline (D-017).
 *
 * Each staged record already holds extracted fields only (no alert text, D-011), so it becomes a
 * `transaction.captured` event directly. No inbox row is written: the inbox exists to hold raw
 * text until the Parser reads it, and there is none here. The Parser takes every field from the
 * event when no inbox item exists.
 *
 * Idempotency: the staged record id is used as the event id and as the `inboxId` (which the
 * Parser turns into the transaction id). The events table has a unique index on id, so a record
 * that is seen again after a crash between the write and the acknowledgement is recognised and
 * only acknowledged, never written twice.
 */
import type { AgentRuntime } from '@steadily/agent-core';
import { events, type SteadilyDb } from '@steadily/db';
import { Id, type NewEvent } from '@steadily/shared-types';
import { eq } from 'drizzle-orm';
// The schema module only: the package root also loads the native module binding.
import { PendingCapture } from 'steadily-capture/src/schemas';

import { APP_KEYS, readAppValue, writeAppValue } from '../data/appSettings';

/** The native staging store, as seen by the drain. */
export interface PendingCaptureStore {
  /** Up to `limit` staged records, oldest first, as JSON strings. Does not remove them. */
  peekRaw(limit: number): Promise<readonly string[]>;
  /** Deletes staged records by id. Returns how many were removed. */
  acknowledge(ids: readonly string[]): Promise<number>;
}

export interface DrainDeps {
  /** Null when the native module is not linked (iOS, web, Jest, Expo Go): the drain is a no-op. */
  store: PendingCaptureStore | null;
  db: SteadilyDb;
  runtime: Pick<AgentRuntime, 'bus' | 'runUntilIdle'>;
  /** Records per native read. */
  batchSize?: number;
  /** Upper bound on records read in one run, so a run always ends. */
  maxPerRun?: number;
  now?: () => Date;
}

/** Counts only: safe to log or store (D-011). */
export type DrainResult = {
  /** New `transaction.captured` events written. */
  written: number;
  /** Records whose event already existed (seen before an earlier acknowledgement failed). */
  duplicates: number;
  /** Records that failed validation; acknowledged and dropped so they cannot block the queue. */
  invalid: number;
  /** Records with no readable id: they cannot be acknowledged and stay staged. */
  unreadable: number;
  /** Records whose write failed; left staged for the next run. */
  failed: number;
  /** What the native store reported removing. */
  acknowledged: number;
};

export const DEFAULT_DRAIN_BATCH = 50;
export const DEFAULT_DRAIN_MAX = 500;

export const emptyDrainResult = (): DrainResult => ({
  written: 0,
  duplicates: 0,
  invalid: 0,
  unreadable: 0,
  failed: 0,
  acknowledged: 0,
});

type Classified =
  | { kind: 'valid'; record: PendingCapture }
  | { kind: 'invalid'; id: string }
  | { kind: 'unreadable' };

/** Never puts any part of the record into an error or log line. */
function classify(json: string): Classified {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { kind: 'unreadable' };
  }
  const parsed = PendingCapture.safeParse(value);
  if (parsed.success) return { kind: 'valid', record: parsed.data };
  const id = Id.safeParse(
    typeof value === 'object' && value !== null ? (value as { id?: unknown }).id : undefined,
  );
  return id.success ? { kind: 'invalid', id: id.data } : { kind: 'unreadable' };
}

/** Only extracted fields reach the event; `merchantName` is recomputed by the Parser. */
export function toCapturedEvent(record: PendingCapture): NewEvent<'transaction.captured'> {
  return {
    type: 'transaction.captured',
    payload: {
      inboxId: record.id,
      source: record.source,
      extracted: record.extracted,
      ...(record.quickCategory ? { quickCategory: record.quickCategory } : {}),
    },
  };
}

function eventExists(db: SteadilyDb, id: string): boolean {
  return db.select({ id: events.id }).from(events).where(eq(events.id, id)).get() !== undefined;
}

type Written = 'written' | 'duplicate' | 'failed';

async function writeRecord(deps: DrainDeps, record: PendingCapture): Promise<Written> {
  if (eventExists(deps.db, record.id)) return 'duplicate';
  try {
    const [prepared] = deps.runtime.bus.prepare([toCapturedEvent(record)], null);
    if (!prepared) return 'failed';
    await deps.runtime.bus.store.append([{ ...prepared, id: record.id }]);
    return 'written';
  } catch {
    // The error is dropped on purpose: database errors can echo values. A unique-index
    // violation means another writer got there first, which is a duplicate, not a failure.
    return eventExists(deps.db, record.id) ? 'duplicate' : 'failed';
  }
}

async function drainOnce(deps: DrainDeps): Promise<DrainResult> {
  const result = emptyDrainResult();
  const { store } = deps;
  if (!store) return result;
  const batchSize = Math.max(1, deps.batchSize ?? DEFAULT_DRAIN_BATCH);
  const maxPerRun = Math.max(1, deps.maxPerRun ?? DEFAULT_DRAIN_MAX);

  let seen = 0;
  while (seen < maxPerRun) {
    const limit = Math.min(batchSize, maxPerRun - seen);
    const batch = await store.peekRaw(limit);
    if (batch.length === 0) break;
    seen += batch.length;

    const done: string[] = [];
    const failedBefore = result.failed;
    for (const json of batch) {
      const item = classify(json);
      if (item.kind === 'unreadable') {
        result.unreadable += 1;
      } else if (item.kind === 'invalid') {
        result.invalid += 1;
        done.push(item.id);
      } else {
        const outcome = await writeRecord(deps, item.record);
        if (outcome === 'failed') {
          result.failed += 1;
        } else {
          result[outcome === 'written' ? 'written' : 'duplicates'] += 1;
          done.push(item.record.id);
        }
      }
    }

    // Acknowledge only what is durably in the event store (or deliberately dropped).
    if (done.length > 0) {
      try {
        result.acknowledged += await store.acknowledge(done);
      } catch {
        // The records stay staged; the next run finds their events and only acknowledges them.
        break;
      }
    }
    // A short batch means the store is empty. After a failed write (the database is likely
    // unhappy) or a batch with no progress, reading again would return the same records: stop
    // and retry on the next trigger. Unreadable records alone do not stop the run.
    if (batch.length < limit || result.failed > failedBefore || done.length === 0) break;
  }

  if (result.invalid > 0 || result.unreadable > 0) {
    recordDropped(deps.db, result, (deps.now ?? (() => new Date()))());
  }
  // Duplicates too: their events may not have been delivered before the earlier run stopped.
  if (result.written > 0 || result.duplicates > 0) await deps.runtime.runUntilIdle();
  return result;
}

/** Persisted drop counters, for diagnostics. Counts only, never record contents. */
export type DrainMetrics = { invalidDropped: number; unreadableSeen: number };

export function readDrainMetrics(db: SteadilyDb): DrainMetrics {
  const value = readAppValue(db, APP_KEYS.captureDrain) as Partial<DrainMetrics> | null;
  const count = (n: unknown) => (typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 0);
  return {
    invalidDropped: count(value?.invalidDropped),
    unreadableSeen: count(value?.unreadableSeen),
  };
}

function recordDropped(db: SteadilyDb, result: DrainResult, at: Date): void {
  try {
    const metrics = readDrainMetrics(db);
    writeAppValue(
      db,
      APP_KEYS.captureDrain,
      {
        invalidDropped: metrics.invalidDropped + result.invalid,
        unreadableSeen: metrics.unreadableSeen + result.unreadable,
      },
      at.toISOString(),
    );
  } catch {
    // Diagnostics only: never fail a drain over them.
  }
}

let running: Promise<unknown> = Promise.resolve();
let queued: Promise<DrainResult> | null = null;

/**
 * Drains the staging store into the event bus, then runs the agents so the Parser, Categorizer
 * and Reconciler process the new captures. Runs are serialized across every trigger (foreground,
 * native event, Headless JS); a call made while one run is waiting reuses that waiting run, which
 * peeks afresh when it starts.
 */
export function drainPendingCaptures(deps: DrainDeps): Promise<DrainResult> {
  if (queued) return queued;
  const run = running.then(() => {
    queued = null;
    return drainOnce(deps);
  });
  queued = run;
  running = run.catch(() => undefined);
  return run;
}
