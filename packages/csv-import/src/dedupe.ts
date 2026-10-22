import { normalizeMerchant, toMerchantKey } from '@steadily/merchants';

import type { ImportRow } from './read';
import { daysBetween, localDayKey } from './values';

/** What happens to a row on import. */
export type RowStatus =
  /** New: it will be imported. */
  | 'new'
  /** This exact row was imported before (same file or an overlapping export). */
  | 'already_imported'
  /** Looks like a transaction Steadily already has, e.g. captured from the bank alert. */
  | 'duplicate';

/** The fields of a stored transaction the duplicate check needs. */
export type ExistingTransaction = {
  id: string;
  occurredAt: string;
  amountMinor: number;
  kind: 'expense' | 'income' | 'transfer' | 'refund';
  merchantName: string | null;
  merchantRaw: string | null;
  accountLast4: string | null;
};

/**
 * How far a file's date may sit from the alert's day: a day earlier (time zones, late-night
 * purchases) up to three days later (checking exports often show the posting date).
 */
export const DUPLICATE_DAYS_BEFORE = 1;
export const DUPLICATE_DAYS_AFTER = 3;

/** Range of stored transactions `classifyRows` needs to see, as ISO instants. */
export function duplicateWindow(rows: readonly ImportRow[]): { from: string; to: string } | null {
  if (rows.length === 0) return null;
  let first = rows[0]!.day;
  let last = first;
  for (const row of rows) {
    if (row.day < first) first = row.day;
    if (row.day > last) last = row.day;
  }
  const [fy, fm, fd] = first.split('-').map(Number) as [number, number, number];
  const [ly, lm, ld] = last.split('-').map(Number) as [number, number, number];
  return {
    from: new Date(fy, fm - 1, fd - DUPLICATE_DAYS_AFTER - 1).toISOString(),
    to: new Date(ly, lm - 1, ld + DUPLICATE_DAYS_BEFORE + 2).toISOString(),
  };
}

/**
 * Sorts each row into new / already imported / duplicate.
 *
 * - `importedIds`: ids of rows imported before (including ones the user later deleted, which
 *   must not come back).
 * - `existing`: stored, non-deleted transactions around the rows' dates.
 *
 * A row is a duplicate of a stored transaction with the same amount and direction, a day within
 * the window, a compatible card ending and a similar merchant (or no merchant on either side).
 * Each stored transaction matches at most one row, nearest day first, so two identical coffees
 * in the file against one alert leave one of them new.
 */
export function classifyRows(
  rows: readonly ImportRow[],
  importedIds: ReadonlySet<string>,
  existing: readonly ExistingTransaction[],
): RowStatus[] {
  const byAmount = new Map<number, { tx: ExistingTransaction; day: string; key: string }[]>();
  for (const tx of existing) {
    if (importedIds.has(tx.id)) continue;
    const list = byAmount.get(tx.amountMinor) ?? [];
    list.push({
      tx,
      day: localDayKey(tx.occurredAt),
      key: toMerchantKey(tx.merchantName ?? tx.merchantRaw ?? ''),
    });
    byAmount.set(tx.amountMinor, list);
  }

  const used = new Set<string>();
  return rows.map((row) => {
    if (importedIds.has(row.id)) return 'already_imported';
    const rowKey = row.description ? normalizeMerchant(row.description).key : '';
    let best: { id: string; distance: number } | null = null;
    for (const candidate of byAmount.get(row.amountMinor) ?? []) {
      const { tx } = candidate;
      if (used.has(tx.id) || !sameDirection(row, tx)) continue;
      const days = daysBetween(candidate.day, row.day);
      if (days < -DUPLICATE_DAYS_BEFORE || days > DUPLICATE_DAYS_AFTER) continue;
      if (row.accountLast4 && tx.accountLast4 && row.accountLast4 !== tx.accountLast4) continue;
      if (!similarMerchant(rowKey, candidate.key)) continue;
      const distance = Math.abs(days);
      if (!best || distance < best.distance) best = { id: tx.id, distance };
    }
    if (!best) return 'new';
    used.add(best.id);
    return 'duplicate';
  });
}

function sameDirection(row: ImportRow, tx: ExistingTransaction): boolean {
  if (tx.kind === 'transfer') return true;
  return row.direction === 'debit' ? tx.kind === 'expense' : tx.kind !== 'expense';
}

/**
 * Merchant keys agree: equal, one a prefix of the other ("starbucks" / "starbucks_store_1234"),
 * or the same first word of 3+ letters. A missing name on either side does not rule a match out
 * (some alerts carry no merchant).
 */
export function similarMerchant(a: string, b: string): boolean {
  if (a === '' || b === '') return true;
  if (a === b || a.startsWith(b) || b.startsWith(a)) return true;
  const first = (key: string) => key.split('_')[0] ?? '';
  const fa = first(a);
  return fa.length >= 3 && fa === first(b);
}
