export * as schema from './schema';
export * from './schema';

/** How long raw captures may sit in the inbox before being purged. */
export const INBOX_TTL_MS = 24 * 60 * 60 * 1000;
