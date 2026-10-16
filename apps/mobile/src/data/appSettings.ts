/**
 * App-only state kept in the `settings` table next to the user settings: onboarding progress,
 * per-issuer setup status and the Budget Coach's last weekly check-in. These keys are outside
 * the Settings contract, so `saveSettings` rejects them and `SqliteSettingsRepo.get()` ignores
 * them; they are read and written here directly. Values are JSON.
 */
import type { LastCheckinStore } from '@steadily/agent-core';
import { settings, type SteadilyDb } from '@steadily/db';
import { eq, sql } from 'drizzle-orm';

export const APP_KEYS = {
  onboarding: 'app.onboarding',
  issuerSetup: 'app.issuerSetup',
  lastCheckin: 'app.lastCheckin',
} as const;

export type AppKey = (typeof APP_KEYS)[keyof typeof APP_KEYS];

/** The stored JSON value, or null if the key was never written. */
export function readAppValue(db: SteadilyDb, key: AppKey): unknown {
  const row = db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .get();
  return row === undefined ? null : row.value;
}

export function writeAppValue(db: SteadilyDb, key: AppKey, value: unknown, at: string): void {
  // Raw JSON text, the same encoding `saveSettings` uses.
  const json = sql`${JSON.stringify(value)}`;
  db.insert(settings)
    .values({ key, value: json, updatedAt: at })
    .onConflictDoUpdate({ target: settings.key, set: { value: json, updatedAt: at } })
    .run();
}

/** Budget Coach check-in memory, so a weekly check-in is sent once even across restarts. */
export function createSettingsCheckinStore(
  db: SteadilyDb,
  clock: () => Date = () => new Date(),
): LastCheckinStore {
  return {
    async get() {
      const value = readAppValue(db, APP_KEYS.lastCheckin);
      return typeof value === 'string' ? value : null;
    },
    async set(slotDate) {
      writeAppValue(db, APP_KEYS.lastCheckin, slotDate, clock().toISOString());
    },
  };
}
