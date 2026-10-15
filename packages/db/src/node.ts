/**
 * Node-only helpers (tests, scripts): better-sqlite3 and the migrations folder.
 * Not exported from the package root, so the app bundle never pulls in `node:fs`.
 */
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateFolder } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

export type NodeDb = BetterSQLite3Database<typeof schema>;

/** Applies pending migrations from `packages/db/migrations`. */
export function migrate(db: NodeDb): void {
  migrateFolder(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

/** Opens a SQLite database (in memory by default), unmigrated. */
export function openNodeDb(filename = ':memory:'): { db: NodeDb; sqlite: Database.Database } {
  const sqlite = new Database(filename);
  sqlite.pragma('foreign_keys = ON');
  return { db: drizzle({ client: sqlite, schema }), sqlite };
}

/** A fresh in-memory database with every migration applied. */
export function createTestDb(): { db: NodeDb; sqlite: Database.Database } {
  const opened = openNodeDb();
  migrate(opened.db);
  return opened;
}
