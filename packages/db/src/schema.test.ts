import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as schema from './schema';

const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));
const migrationSql = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => readFileSync(join(migrationsDir, file), 'utf8'))
  .join('\n');

describe('db schema', () => {
  const tables = [
    schema.transactions,
    schema.events,
    schema.processedEvents,
    schema.failedEvents,
    schema.runtimeCursors,
    schema.inbox,
    schema.userRules,
    schema.categoryPrefs,
    schema.budgets,
    schema.subscriptions,
    schema.issuers,
    schema.settings,
  ];

  it('has a migration for every table', () => {
    for (const table of tables) {
      expect(migrationSql).toContain(`CREATE TABLE \`${getTableName(table)}\``);
    }
  });

  it('keeps raw text only in the inbox table (D-011)', () => {
    for (const table of tables) {
      const columns = Object.keys(getTableColumns(table));
      if (table === schema.inbox) {
        expect(columns).toContain('rawText');
      } else {
        expect(columns).not.toContain('rawText');
      }
    }
  });

  it('never stores full account numbers', () => {
    const columns = Object.keys(getTableColumns(schema.transactions));
    expect(columns).toContain('accountLast4');
    expect(columns.some((c) => /accountNumber|cardNumber/i.test(c))).toBe(false);
  });

  it('makes synced tables tombstone-ready', () => {
    for (const table of [
      schema.transactions,
      schema.userRules,
      schema.budgets,
      schema.subscriptions,
    ]) {
      const columns = Object.keys(getTableColumns(table));
      expect(columns).toEqual(expect.arrayContaining(['id', 'updatedAt', 'deletedAt']));
    }
  });
});
