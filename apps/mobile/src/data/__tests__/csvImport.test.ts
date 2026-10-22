import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { detectFormat, parseCsv, readRows, type ImportRow } from '@steadily/csv-import';
import { events, inbox } from '@steadily/db';
import { createTestDb, type NodeDb } from '@steadily/db/node';
import { Transaction } from '@steadily/shared-types';

import { createRepoDataSource, type AlertCapture } from '../repoDataSource';
import { createAppLogger, createAppRuntime } from '../runtime';

/** Thursday, October 15 2026, 9:30 AM local time. */
const NOW = new Date(2026, 9, 15, 9, 30);
const MONTH = {
  from: new Date(2026, 9, 1).toISOString(),
  to: new Date(2026, 10, 1).toISOString(),
};
const newId = () => globalThis.crypto.randomUUID();

function launch(db: NodeDb = createTestDb().db) {
  const app = createAppRuntime(db, { newId, clock: () => NOW, log: createAppLogger(false) });
  const source = createRepoDataSource({ db, ...app, newId, now: () => NOW });
  return { db, source, ...app };
}

/** Synthetic fixture files shared with the parser tests. */
function rowsFrom(name: string): ImportRow[] {
  const text = readFileSync(
    join(__dirname, '../../../../../packages/csv-import/fixtures', `${name}.csv`),
    'utf8',
  );
  const table = parseCsv(text);
  return readRows(table, detectFormat(table)!).rows;
}

// The same coffee, already captured from the bank's push notification (synthetic).
const COFFEE_ALERT: AlertCapture = {
  text: 'You made a $5.75 transaction with SQ *BLUE BOTTLE COFFEE on your card ending in 1234',
  source: 'android_notification',
  androidPackage: 'com.chase.sig.android',
  occurredAt: new Date(2026, 9, 14, 8, 5).toISOString(),
};

describe('CSV import through the agent pipeline', () => {
  it('imports new rows, skips the one the alert already logged, and categorizes', async () => {
    const { source, db } = launch();
    await source.captureAlerts([COFFEE_ALERT]);
    const rows = rowsFrom('chase_card');
    expect(rows).toHaveLength(6);

    const check = await source.checkImport!(rows);
    expect(check.statuses).toEqual(['duplicate', 'new', 'new', 'new', 'new', 'new']);
    expect(check).toMatchObject({ newCount: 5, duplicateCount: 1, alreadyImportedCount: 0 });

    const listener = jest.fn();
    source.subscribe(listener);
    const result = await source.importRows!(rows);
    expect(result).toEqual({ imported: 5, needsReview: 1, duplicates: 1, alreadyImported: 0 });
    expect(listener).toHaveBeenCalled();

    const txs = await source.listTransactions(MONTH);
    expect(txs).toHaveLength(6);
    for (const tx of txs) expect(Transaction.safeParse(tx).success).toBe(true);
    const imported = txs.filter((t) => t.source === 'csv_import');
    expect(imported.map((t) => t.id).sort()).toEqual(
      rows
        .slice(1)
        .map((r) => r.id)
        .sort(),
    );
    expect(imported.every((t) => t.issuerId === 'chase')).toBe(true);

    const byId = new Map(imported.map((t) => [t.id, t]));
    // A known coffee shop: categorized and confirmed by the Categorizer.
    expect(byId.get(rows[4]!.id)).toMatchObject({
      kind: 'expense',
      categoryId: 'food.coffee',
      status: 'confirmed',
      merchantName: 'Blue Bottle Coffee',
      occurredAt: new Date(2026, 9, 8, 12).toISOString(),
    });
    // An unknown shop waits for review.
    expect(byId.get(rows[1]!.id)).toMatchObject({ kind: 'expense', status: 'needs_review' });
    // The card payment is a transfer, not income.
    expect(byId.get(rows[2]!.id)).toMatchObject({ kind: 'transfer', status: 'confirmed' });

    // No inbox items: there was never raw text to keep.
    expect(db.select().from(inbox).all()).toEqual([]);
  });

  it('is idempotent: importing the same file again adds nothing', async () => {
    const { source, db } = launch();
    const rows = rowsFrom('chase_card');
    await source.importRows!(rows);
    const before = await source.listTransactions(MONTH);
    const eventCount = db.select().from(events).all().length;

    const check = await source.checkImport!(rows);
    expect(check).toMatchObject({ newCount: 0, alreadyImportedCount: 6 });
    expect(await source.importRows!(rows)).toEqual({
      imported: 0,
      needsReview: 0,
      duplicates: 0,
      alreadyImported: 6,
    });
    expect(await source.listTransactions(MONTH)).toEqual(before);
    // Nothing was even published.
    expect(db.select().from(events).all()).toHaveLength(eventCount);

    // Even a re-delivered capture event finds the transaction by its id.
    const { runtime } = launch(db);
    await runtime.bus.publish(
      [
        {
          type: 'transaction.captured',
          payload: {
            inboxId: rows[1]!.id,
            source: 'csv_import',
            extracted: {
              amountMinor: rows[1]!.amountMinor,
              currency: 'USD',
              direction: rows[1]!.direction,
              occurredAt: rows[1]!.occurredAt,
            },
          },
        },
      ],
      null,
    );
    await runtime.runUntilIdle();
    expect(await source.listTransactions(MONTH)).toHaveLength(before.length);
  });

  it('does not bring back a transaction the user deleted', async () => {
    const { source, repos } = launch();
    const rows = rowsFrom('amex');
    await source.importRows!(rows);
    await repos.transactions.update(rows[0]!.id, {
      deletedAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });

    const result = await source.importRows!(rows);
    expect(result).toMatchObject({ imported: 0, alreadyImported: 3 });
    expect(await source.getTransaction(rows[0]!.id)).toBeNull();
  });

  it('keeps P2P credits as transfers and people out of rules', async () => {
    const { source } = launch();
    const rows = rowsFrom('venmo');
    await source.importRows!(rows);
    const txs = await source.listTransactions(MONTH);
    expect(txs.map((t) => [t.merchantName, t.kind]).sort()).toEqual([
      ['Jordan Example', 'transfer'],
      ['Sam Example', 'expense'],
      ['Standard Transfer', 'transfer'],
    ]);
  });

  it('imports in batches with progress', async () => {
    const { source } = launch();
    const lines = ['Date,Description,Card Member,Account #,Amount'];
    for (let i = 0; i < 250; i++) {
      lines.push(
        `10/${String((i % 14) + 1).padStart(2, '0')}/2026,EXAMPLE SHOP ${i},A,-10000,1.${String(i % 100).padStart(2, '0')}`,
      );
    }
    const table = parseCsv(lines.join('\n'));
    const { rows } = readRows(table, detectFormat(table)!);
    expect(rows).toHaveLength(250);

    const progress: [number, number][] = [];
    const result = await source.importRows!(rows, (done, total) => progress.push([done, total]));
    expect(progress).toEqual([
      [0, 250],
      [100, 250],
      [200, 250],
      [250, 250],
    ]);
    expect(result.imported).toBe(250);
    expect(await source.listTransactions(MONTH)).toHaveLength(250);
  });
});
