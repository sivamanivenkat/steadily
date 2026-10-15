import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

/**
 * Any synchronous Drizzle SQLite database: `drizzle-orm/expo-sqlite` on device,
 * `drizzle-orm/better-sqlite3` in Node tests. Repositories and the event store
 * use the sync query API (`.all()`, `.get()`, `.run()`) and sync transactions,
 * which both drivers support, wrapped in async methods for the ports.
 */
export type SteadilyDb = BaseSQLiteDatabase<'sync', any, any>;
