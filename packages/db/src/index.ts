export * as schema from './schema';
export * from './schema';
export type { SteadilyDb } from './client';
export * from './repos';
export { SqliteEventStore } from './event-store';
export { migrateWithBundle, type MigrationBundle } from './migrate';

/** How long raw captures may sit in the inbox before being purged. */
export const INBOX_TTL_MS = 24 * 60 * 60 * 1000;
