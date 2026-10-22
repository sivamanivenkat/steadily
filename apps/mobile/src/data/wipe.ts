/**
 * "Delete all my data" (D-011). Platform-free so it can be tested with mocks; `appDataSource.ts`
 * wires it to the real database, keystore and native capture store.
 *
 * Order matters:
 * 1. Captures still staged by the native layer are removed first, so none of them can be drained
 *    into the new, empty database afterwards.
 * 2. The database file and its key are deleted. Without the key the old file can never be read,
 *    so deleting the key is the step that must succeed; a leftover file is replaced on next open.
 */
import { Id } from '@steadily/shared-types';

import type { PendingCaptureStore } from '../capture/drain';

const CLEAR_BATCH = 100;
/** Upper bound on native reads, so a store that keeps returning records cannot loop forever. */
const MAX_CLEAR_ROUNDS = 1_000;

/** Counts only. */
export type ClearResult = {
  /** Records the native store reported removing. */
  cleared: number;
  /** Records with no readable id: the module offers no way to remove them. */
  stuck: number;
};

function recordId(json: string): string | null {
  try {
    const value: unknown = JSON.parse(json);
    if (typeof value !== 'object' || value === null) return null;
    const id = Id.safeParse((value as { id?: unknown }).id);
    return id.success ? id.data : null;
  } catch {
    return null;
  }
}

/**
 * Acknowledges every staged capture, valid or not, without reading anything but its id. The
 * capture module has no "clear all" call, so this pages through it with peek + acknowledge.
 * A no-op when the module is not linked (iOS, web, Jest).
 */
export async function clearPendingCaptures(
  store: PendingCaptureStore | null,
): Promise<ClearResult> {
  const result: ClearResult = { cleared: 0, stuck: 0 };
  if (!store) return result;
  for (let round = 0; round < MAX_CLEAR_ROUNDS; round++) {
    const batch = await store.peekRaw(CLEAR_BATCH);
    if (batch.length === 0) return result;
    const ids = batch.map(recordId).filter((id): id is string => id !== null);
    const unreadable = batch.length - ids.length;
    const removed = ids.length > 0 ? await store.acknowledge(ids) : 0;
    result.cleared += removed;
    if (removed === 0) {
      // Nothing more can be removed: what is left has no id, or the store refused.
      result.stuck = batch.length;
      return result;
    }
    // Unreadable records stay at the head of the queue; once only they are left, stop.
    if (unreadable === batch.length) {
      result.stuck = unreadable;
      return result;
    }
  }
  return result;
}

export type WipeDeps = {
  /** Removes captures staged natively. */
  clearStaging: () => Promise<ClearResult>;
  /** Closes and deletes the database file. May fail; the key deletion still runs. */
  deleteDatabase: () => Promise<void>;
  /** Deletes the database key from the platform keystore. */
  deleteKey: () => Promise<void>;
};

/** Fixed message: underlying errors could echo paths or values. */
export class WipeError extends Error {
  constructor(readonly step: 'staging' | 'database') {
    super('Could not delete all data');
    this.name = 'WipeError';
  }
}

/**
 * If the staged captures cannot be cleared, stops before touching the database, so nothing has
 * changed and the user can try again. Otherwise deletes the file and the key, and fails only if
 * both failed (either one alone leaves the old data unreadable).
 */
export async function wipeAllData(deps: WipeDeps): Promise<void> {
  try {
    await deps.clearStaging();
  } catch {
    throw new WipeError('staging');
  }
  let fileDeleted = true;
  try {
    await deps.deleteDatabase();
  } catch {
    fileDeleted = false;
  }
  let keyDeleted = true;
  try {
    await deps.deleteKey();
  } catch {
    keyDeleted = false;
  }
  if (!fileDeleted && !keyDeleted) throw new WipeError('database');
}
