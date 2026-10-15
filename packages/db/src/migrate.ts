import type { SteadilyDb } from './client';

/**
 * The drizzle-kit migration bundle: `migrations/migrations.js`, exported as
 * `@steadily/db/migrations`. Importing it needs the `.sql` files inlined as
 * strings (babel-plugin-inline-import in the Expo app).
 */
export interface MigrationBundle {
  journal: {
    entries: { idx: number; when: number; tag: string; breakpoints: boolean }[];
  };
  migrations: Record<string, string>;
}

interface MigrationMeta {
  sql: string[];
  bps: boolean;
  folderMillis: number;
  hash: string;
}

/** The parts of Drizzle's sync SQLite internals the migrator needs. */
interface SyncMigrator {
  dialect: { migrate(migrations: MigrationMeta[], session: unknown): void };
  session: unknown;
}

/**
 * Applies pending migrations from the bundle, for app startup on any sync
 * Drizzle SQLite driver (expo-sqlite). Same logic as
 * `drizzle-orm/expo-sqlite/migrator`, minus its React import, and it shares
 * the `__drizzle_migrations` bookkeeping with the folder-based migrator used in
 * Node (`@steadily/db/node`), which also tracks migrations by their `when`.
 */
export function migrateWithBundle(db: SteadilyDb, bundle: MigrationBundle): void {
  const migrations = bundle.journal.entries.map((entry): MigrationMeta => {
    const query = bundle.migrations[`m${entry.idx.toString().padStart(4, '0')}`];
    if (query === undefined) throw new Error(`Missing migration: ${entry.tag}`);
    return {
      sql: query.split('--> statement-breakpoint'),
      bps: entry.breakpoints,
      folderMillis: entry.when,
      hash: '',
    };
  });
  const internals = db as unknown as SyncMigrator;
  internals.dialect.migrate(migrations, internals.session);
}
