import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrateWithBundle, type MigrationBundle } from './migrate';
import { MIGRATIONS_FOLDER, migrate, openNodeDb } from './node';

/** Builds the same bundle `migrations/migrations.js` gives Expo, from the folder. */
function loadBundle(): MigrationBundle {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
  ) as MigrationBundle['journal'];
  const migrations: Record<string, string> = {};
  for (const entry of journal.entries) {
    migrations[`m${entry.idx.toString().padStart(4, '0')}`] = readFileSync(
      join(MIGRATIONS_FOLDER, `${entry.tag}.sql`),
      'utf8',
    );
  }
  return { journal, migrations };
}

function tableNames(sqlite: ReturnType<typeof openNodeDb>['sqlite']): string[] {
  return (
    sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((row) => row.name);
}

const EXPECTED_TABLES = [
  'budgets',
  'category_prefs',
  'events',
  'failed_events',
  'inbox',
  'issuers',
  'processed_events',
  'runtime_cursors',
  'settings',
  'subscriptions',
  'transactions',
  'user_rules',
];

describe('migrations', () => {
  it('folder migrator creates every table and is idempotent', () => {
    const { db, sqlite } = openNodeDb();
    migrate(db);
    migrate(db);
    expect(tableNames(sqlite)).toEqual(expect.arrayContaining(EXPECTED_TABLES));
  });

  it('bundle migrator produces the same tables and shares bookkeeping', () => {
    const viaBundle = openNodeDb();
    migrateWithBundle(viaBundle.db, loadBundle());
    migrateWithBundle(viaBundle.db, loadBundle());
    expect(tableNames(viaBundle.sqlite)).toEqual(
      tableNames(
        (() => {
          const viaFolder = openNodeDb();
          migrate(viaFolder.db);
          return viaFolder.sqlite;
        })(),
      ),
    );
    // A database migrated with the bundle is up to date for the folder migrator too.
    migrate(viaBundle.db);
  });

  it('bundle migrator fails on a missing migration', () => {
    const bundle = loadBundle();
    const { db } = openNodeDb();
    expect(() => migrateWithBundle(db, { ...bundle, migrations: {} })).toThrow('Missing migration');
  });
});
