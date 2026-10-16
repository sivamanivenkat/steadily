/**
 * The on-device database (D-011): SQLite encrypted with SQLCipher, opened through expo-sqlite
 * and wrapped in Drizzle. Device only; tests use `@steadily/db/node` instead.
 *
 * Key handling: a random 256-bit key is generated on first launch and kept in the platform
 * keystore (expo-secure-store: iOS Keychain, Android Keystore), readable only on this device
 * after the first unlock. The key is never logged, never leaves the device and never appears in
 * an error message.
 */
import { migrateWithBundle, schema, type SteadilyDb } from '@steadily/db';
import migrations from '@steadily/db/migrations';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { deleteDatabaseSync, openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

const DATABASE_NAME = 'steadily.db';
const KEY_ITEM = 'steadily.db-key.v1';
const KEY_BYTES = 32;
/** 64 hex characters: the only shape ever interpolated into `PRAGMA key`. */
const HEX_KEY = /^[0-9a-f]{64}$/;

const KEY_OPTIONS: SecureStore.SecureStoreOptions = {
  // Background capture may need the database while the phone is locked, after the first unlock.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** Errors carry a fixed message: nothing about the key or the data. */
export class DatabaseOpenError extends Error {
  constructor(reason: 'bad_key' | 'not_encrypted' | 'wrong_key') {
    super(`Could not open the encrypted database (${reason})`);
    this.name = 'DatabaseOpenError';
  }
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/**
 * The stored key, or a new one. Without a stored key, an existing database file can never be
 * read again (iOS keeps app files only as long as the app; Android deletes the keystore entry
 * with the app), so it is replaced with an empty one.
 */
async function loadOrCreateKey(): Promise<string> {
  const stored = await SecureStore.getItemAsync(KEY_ITEM, KEY_OPTIONS);
  if (stored !== null) {
    if (!HEX_KEY.test(stored)) throw new DatabaseOpenError('bad_key');
    return stored;
  }
  try {
    deleteDatabaseSync(DATABASE_NAME);
  } catch {
    // No database yet: the normal first launch.
  }
  const key = toHex(getRandomBytes(KEY_BYTES));
  await SecureStore.setItemAsync(KEY_ITEM, key, KEY_OPTIONS);
  return key;
}

function applyKey(sqlite: SQLiteDatabase, key: string): void {
  if (!HEX_KEY.test(key)) throw new DatabaseOpenError('bad_key');
  // PRAGMA cannot take bound parameters. The key is validated hex, used as a raw 256-bit key
  // (SQLCipher's x'...' form, no key derivation needed for random bytes).
  sqlite.execSync(`PRAGMA key = "x'${key}'"`);

  // An empty cipher_version means the native build has no SQLCipher: refuse to store anything.
  const cipher = sqlite.getFirstSync<{ cipher_version?: string }>('PRAGMA cipher_version');
  if (!cipher?.cipher_version) throw new DatabaseOpenError('not_encrypted');
  try {
    // The first real read fails if the key does not match the file.
    sqlite.getFirstSync('SELECT count(*) FROM sqlite_master');
  } catch {
    throw new DatabaseOpenError('wrong_key');
  }
}

export type OpenedDatabase = { db: SteadilyDb; sqlite: SQLiteDatabase };

let opening: Promise<OpenedDatabase> | null = null;

async function open(): Promise<OpenedDatabase> {
  const key = await loadOrCreateKey();
  const sqlite = openDatabaseSync(DATABASE_NAME);
  try {
    applyKey(sqlite, key);
    sqlite.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    const db = drizzle(sqlite, { schema });
    migrateWithBundle(db, migrations);
    return { db, sqlite };
  } catch (error) {
    sqlite.closeSync();
    throw error;
  }
}

/** Opens (once per app process), unlocks and migrates the database. */
export function openDatabase(): Promise<OpenedDatabase> {
  if (!opening) {
    opening = open().catch((error: unknown) => {
      opening = null;
      throw error;
    });
  }
  return opening;
}
