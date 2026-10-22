/**
 * CSV import into the agent pipeline (D-011, D-017). The screen parses the file on the phone and
 * hands over extracted rows only; the file text never reaches this module. Each new row is
 * published as a `transaction.captured` event with source `csv_import` and no inbox item (there
 * is no raw text to keep), so the Parser, Categorizer and Reconciler treat it like any capture.
 *
 * Idempotent: a row's id is derived from its fields and doubles as the transaction id, so the
 * Parser finds the transaction a previous import created and never adds a second one. Rows that
 * look like a transaction already captured (e.g. from the bank alert) are skipped.
 */
import {
  classifyRows,
  duplicateWindow,
  type ImportRow,
  type RowStatus,
} from '@steadily/csv-import';
import { transactions as transactionsTable, type SteadilyDb } from '@steadily/db';
import type { NewEvent } from '@steadily/shared-types';
import { inArray } from 'drizzle-orm';

import type { AppRuntime } from './runtime';

/** Rows published per agent run, so progress moves and the UI stays responsive. */
export const IMPORT_BATCH_SIZE = 100;
const ID_QUERY_CHUNK = 500;

export type ImportCheck = {
  /** One status per row, in order. */
  statuses: RowStatus[];
  newCount: number;
  duplicateCount: number;
  alreadyImportedCount: number;
};

export type ImportResult = {
  /** New transactions now in Steadily. */
  imported: number;
  /** Of those, how many wait in the review queue for a category. */
  needsReview: number;
  /** Skipped: already in Steadily from an alert, share or entry. */
  duplicates: number;
  /** Skipped: imported before. */
  alreadyImported: number;
};

export type ImportProgress = (done: number, total: number) => void;

export type CsvImporterDeps = AppRuntime & {
  db: SteadilyDb;
  now: () => Date;
  /** Tells screens to reload once the import finishes. */
  notify: () => void;
};

export function createCsvImporter({ db, runtime, repos, now, notify }: CsvImporterDeps) {
  /** Ids among `ids` that already have a transaction, deleted ones included. */
  function existingIds(ids: readonly string[]): Set<string> {
    const found = new Set<string>();
    for (let i = 0; i < ids.length; i += ID_QUERY_CHUNK) {
      const chunk = ids.slice(i, i + ID_QUERY_CHUNK);
      for (const { id } of db
        .select({ id: transactionsTable.id })
        .from(transactionsTable)
        .where(inArray(transactionsTable.id, chunk))
        .all()) {
        found.add(id);
      }
    }
    return found;
  }

  async function check(rows: readonly ImportRow[]): Promise<ImportCheck> {
    const imported = existingIds(rows.map((r) => r.id));
    const window = duplicateWindow(rows);
    const existing = window ? await repos.transactions.listBetween(window.from, window.to) : [];
    const statuses = classifyRows(rows, imported, existing);
    const count = (status: RowStatus) => statuses.filter((s) => s === status).length;
    return {
      statuses,
      newCount: count('new'),
      duplicateCount: count('duplicate'),
      alreadyImportedCount: count('already_imported'),
    };
  }

  async function run(
    rows: readonly ImportRow[],
    onProgress?: ImportProgress,
  ): Promise<ImportResult> {
    const { statuses, duplicateCount, alreadyImportedCount } = await check(rows);
    const fresh = rows.filter((_, i) => statuses[i] === 'new');
    onProgress?.(0, fresh.length);

    try {
      for (let i = 0; i < fresh.length; i += IMPORT_BATCH_SIZE) {
        const batch = fresh.slice(i, i + IMPORT_BATCH_SIZE);
        await runtime.bus.publish(batch.map(capturedEvent), null);
        await runtime.runUntilIdle();
        await applyTransferHints(batch);
        onProgress?.(Math.min(i + IMPORT_BATCH_SIZE, fresh.length), fresh.length);
        // Let the progress bar paint between batches.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      // Whatever got in stays in (a re-import picks up the rest); screens reload either way.
      notify();
    }

    let imported = 0;
    let needsReview = 0;
    for (const row of fresh) {
      const tx = await repos.transactions.get(row.id);
      if (!tx || tx.deletedAt !== null) continue;
      imported++;
      if (tx.status === 'needs_review') needsReview++;
    }
    return {
      imported,
      needsReview,
      // Rows the Reconciler still found to be duplicates count as duplicates too.
      duplicates: duplicateCount + (fresh.length - imported),
      alreadyImported: alreadyImportedCount,
    };
  }

  /**
   * Card payments and own-account moves the file marks as such (e.g. Chase "Payment") are not
   * spending or income. The event has no field for that, so it is applied once the agents ran.
   */
  async function applyTransferHints(batch: readonly ImportRow[]): Promise<void> {
    const at = now().toISOString();
    for (const row of batch) {
      if (!row.transfer) continue;
      const tx = await repos.transactions.get(row.id);
      if (!tx || tx.deletedAt !== null || tx.kind === 'transfer') continue;
      await repos.transactions.update(row.id, {
        kind: 'transfer',
        status: 'confirmed',
        linkedTransactionId: null,
        updatedAt: at,
      });
    }
  }

  return { check, run };
}

/** Extracted fields only; the row id becomes the transaction id. */
function capturedEvent(row: ImportRow): NewEvent {
  return {
    type: 'transaction.captured',
    payload: {
      inboxId: row.id,
      source: 'csv_import',
      extracted: {
        amountMinor: row.amountMinor,
        currency: 'USD',
        direction: row.direction,
        occurredAt: row.occurredAt,
        ...(row.description ? { merchantRaw: row.description } : {}),
        ...(row.issuerId ? { issuerId: row.issuerId } : {}),
        ...(row.accountLast4 ? { accountLast4: row.accountLast4 } : {}),
      },
    },
  };
}
