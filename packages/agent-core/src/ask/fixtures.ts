// Synthetic data for the ask tests. Not exported from the package.
import type { Transaction } from '@steadily/shared-types';
import { createInMemoryRepos } from '../ports';
import type { Budget, Subscription } from '../ports';
import type { ToolContext } from './tools';

export const NY = 'America/New_York';
/** Oct 15 2026, 12:00 in New York (EDT). */
export const NOW = new Date('2026-10-15T16:00:00.000Z');

let counter = 0;
export function tx(overrides: Partial<Transaction> = {}): Transaction {
  counter += 1;
  return {
    id: `20000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    deletedAt: null,
    occurredAt: '2026-10-05T16:00:00.000Z',
    amountMinor: 1000,
    currency: 'USD',
    kind: 'expense',
    merchantRaw: null,
    merchantName: 'Synthetic Shop',
    categoryId: 'shopping.general',
    categoryConfidence: 0.95,
    categorySource: 'dictionary',
    status: 'confirmed',
    source: 'manual',
    accountLast4: null,
    issuerId: null,
    txnRef: null,
    note: null,
    linkedTransactionId: null,
    ...overrides,
  };
}

export function budget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: `30000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
    categoryId: null,
    period: 'monthly',
    amountMinor: 100000,
    currency: 'USD',
    rollover: false,
    ...overrides,
  };
}

export function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: `40000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    merchantName: 'Netflix',
    cadence: 'monthly',
    amountMinor: 1549,
    currency: 'USD',
    categoryId: 'subscriptions.general',
    lastChargedAt: '2026-09-20T12:00:00.000Z',
    nextDueAt: '2026-10-20T12:00:00.000Z',
    dismissed: false,
    ...overrides,
  };
}

export const SECRET_NOTE = 'rent split with Jane Quill';
export const PERSON_NAME = 'Jane Quill';

/** A month of plausible data around NOW. All names are fictional. */
export function seedRepos() {
  const repos = createInMemoryRepos();
  const rows: Transaction[] = [];
  const trader = tx({
    merchantName: "Trader Joe's",
    categoryId: 'food.groceries',
    amountMinor: 12000,
    occurredAt: '2026-10-03T16:00:00.000Z',
  });
  rows.push(
    trader,
    // A duplicate of the Trader Joe's row: linked, must not count twice.
    tx({
      merchantName: "Trader Joe's",
      categoryId: 'food.groceries',
      amountMinor: 12000,
      occurredAt: '2026-10-03T16:00:30.000Z',
      linkedTransactionId: trader.id,
    }),
    tx({
      merchantName: 'Whole Foods Market',
      categoryId: 'food.groceries',
      amountMinor: 8000,
      occurredAt: '2026-10-05T16:00:00.000Z',
    }),
    tx({
      merchantName: 'Starbucks',
      categoryId: 'food.coffee',
      amountMinor: 1500,
      occurredAt: '2026-10-06T12:00:00.000Z',
    }),
    tx({
      merchantName: 'Starbucks',
      categoryId: 'food.coffee',
      amountMinor: 1500,
      occurredAt: '2026-10-09T12:00:00.000Z',
    }),
  );
  const taqueria = tx({
    merchantName: 'Taqueria Sol',
    categoryId: 'food.dining',
    amountMinor: 4000,
    occurredAt: '2026-10-07T23:00:00.000Z',
  });
  rows.push(
    taqueria,
    tx({
      kind: 'refund',
      merchantName: 'Taqueria Sol',
      categoryId: 'food.dining',
      amountMinor: 1000,
      occurredAt: '2026-10-08T16:00:00.000Z',
      linkedTransactionId: taqueria.id,
    }),
    // Unlinked refund: ignored until reconciled.
    tx({
      kind: 'refund',
      merchantName: 'Mystery Store',
      categoryId: 'shopping.general',
      amountMinor: 700,
      occurredAt: '2026-10-08T16:00:00.000Z',
    }),
    tx({
      kind: 'transfer',
      merchantName: 'Own Savings',
      categoryId: 'other.general',
      amountMinor: 50000,
      occurredAt: '2026-10-02T16:00:00.000Z',
    }),
    tx({
      kind: 'income',
      merchantName: 'Employer',
      categoryId: 'other.general',
      amountMinor: 200000,
      occurredAt: '2026-10-01T16:00:00.000Z',
    }),
    // Payment to a person through Venmo, with a note.
    tx({
      merchantName: PERSON_NAME,
      merchantRaw: 'VENMO PAYMENT JANE QUILL',
      issuerId: 'venmo',
      categoryId: 'gifts.general',
      amountMinor: 2500,
      note: SECRET_NOTE,
      accountLast4: '4242',
      occurredAt: '2026-10-10T16:00:00.000Z',
    }),
    // PayPal checkout at a dictionary merchant: a business, not a person.
    tx({
      merchantName: 'Spotify',
      issuerId: 'paypal',
      categoryId: 'subscriptions.general',
      amountMinor: 1099,
      occurredAt: '2026-10-11T16:00:00.000Z',
    }),
    // September.
    tx({
      merchantName: "Trader Joe's",
      categoryId: 'food.groceries',
      amountMinor: 20000,
      occurredAt: '2026-09-12T16:00:00.000Z',
    }),
    tx({
      merchantName: 'Taqueria Sol',
      categoryId: 'food.dining',
      amountMinor: 5000,
      occurredAt: '2026-09-14T16:00:00.000Z',
    }),
    // Deleted rows never count.
    tx({ amountMinor: 99999, deletedAt: '2026-10-06T00:00:00.000Z' }),
    // Other currency never counts toward USD.
    tx({ amountMinor: 88888, currency: 'EUR' }),
  );
  for (const row of rows) repos.transactions.rows.set(row.id, row);
  return repos;
}

export function context(
  repos: ReturnType<typeof seedRepos>,
  overrides: Partial<ToolContext> = {},
): ToolContext {
  return { repos, now: NOW, timeZone: NY, privacy: 'local', ...overrides };
}
