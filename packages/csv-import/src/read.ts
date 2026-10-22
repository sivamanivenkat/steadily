import type { CsvTable } from './csv';
import {
  formatForHeader,
  isWellsFargoRow,
  normalizeHeader,
  signedAmount,
  splitAmount,
  WELLS_FARGO,
  type CsvFormat,
  type RawRow,
} from './formats';
import { rowIdFor } from './rowId';
import { dayKey, localNoonIso, parseAmount, parseDate } from './values';

/** Most data rows one import accepts. Bigger files should be split by date range. */
export const MAX_IMPORT_ROWS = 10_000;
/** Longest description kept (the transaction schema's merchant limit). */
export const MAX_DESCRIPTION_LENGTH = 200;
/** Rows above a header that may hold a statement preamble (Venmo, Bank of America). */
const HEADER_SEARCH_ROWS = 20;

/**
 * One transaction read from a file: extracted fields only. The raw cells are dropped once a row
 * is read (D-011).
 */
export type ImportRow = {
  /** Stable id derived from the fields below, so a re-import finds the same transaction. */
  id: string;
  /** Calendar day as written in the file, "2026-10-15". */
  day: string;
  /** Local noon on `day`. */
  occurredAt: string;
  /** Positive whole cents. */
  amountMinor: number;
  direction: 'debit' | 'credit';
  /** Merchant or counterparty as written, whitespace tidied; may be empty. */
  description: string;
  /** Rule-pack issuer id of a recognised layout. */
  issuerId?: string;
  accountLast4?: string;
  /** A card payment or own-account move: not spending, not income. */
  transfer?: boolean;
};

/** Column choices for a file in no known layout. Indexes into the row cells. */
export type ColumnMapping = {
  /** Row index of the header, or -1 when the file has none. */
  headerRow: number;
  date: number;
  description: number;
  amount:
    | { kind: 'single'; column: number; spending: 'negative' | 'positive' }
    | { kind: 'split'; debit: number; credit: number };
};

/** How to read a file: a recognised layout, or the user's column mapping. */
export type ImportPlan =
  | { kind: 'format'; format: CsvFormat; headerRow: number }
  | { kind: 'mapping'; mapping: ColumnMapping };

export type ReadResult = {
  rows: ImportRow[];
  /** Data rows in the file (after the header). */
  total: number;
  /** Rows left out: unreadable dates or amounts, zero amounts, pending or balance lines. */
  skipped: number;
};

/** Finds a known layout by its header row (searching past a short preamble). */
export function detectFormat(table: CsvTable): ImportPlan | null {
  const limit = Math.min(table.length, HEADER_SEARCH_ROWS);
  for (let i = 0; i < limit; i++) {
    const format = formatForHeader(table[i]!);
    if (format) return { kind: 'format', format, headerRow: i };
  }
  if (table[0] && isWellsFargoRow(table[0])) {
    return { kind: 'format', format: WELLS_FARGO, headerRow: -1 };
  }
  return null;
}

const DATE_HEADER = /date|posted|time/;
const DESCRIPTION_HEADERS = [/description/, /payee|merchant/, /^name$|name/, /memo|details/];
const AMOUNT_HEADER = /amount|^total$|gross|^net$/;
const DEBIT_HEADER = /debit|withdrawal|money out|charge/;
const CREDIT_HEADER = /credit|deposit|money in|payment/;

/**
 * A first guess at the columns of an unknown file, for the mapping screen to start from. Uses
 * header names when there is a header, otherwise the values in the first rows. Columns it cannot
 * place are -1.
 */
export function guessMapping(table: CsvTable): ColumnMapping {
  const headerRow = findHeaderRow(table);
  const width = Math.max(0, ...table.slice(0, 50).map((row) => row.length));
  const sample = table.slice(headerRow + 1, headerRow + 51);
  const header = headerRow >= 0 ? table[headerRow]!.map(normalizeHeader) : [];

  const share = (column: number, test: (cell: string) => boolean) => {
    const cells = sample.map((row) => row[column] ?? '').filter((c) => c.trim() !== '');
    return cells.length === 0 ? 0 : cells.filter(test).length / cells.length;
  };
  const dateLike = (c: number) => share(c, (cell) => parseDate(cell) !== null) >= 0.8;
  const amountLike = (c: number) => share(c, (cell) => parseAmount(cell) !== null) >= 0.8;
  const columns = [...Array(width).keys()];
  const byHeader = (pattern: RegExp, ok: (c: number) => boolean = () => true) =>
    columns.find((c) => pattern.test(header[c] ?? '') && ok(c)) ?? -1;

  // Dates: prefer the transaction date over the posting date.
  let date = byHeader(/trans.*date|^date$/, dateLike);
  if (date < 0) date = byHeader(DATE_HEADER, dateLike);
  if (date < 0) date = columns.find(dateLike) ?? -1;

  let description = -1;
  for (const pattern of DESCRIPTION_HEADERS) {
    description = byHeader(pattern, (c) => c !== date && !amountLike(c));
    if (description >= 0) break;
  }
  if (description < 0) {
    // The column with the longest text that is neither a date nor an amount.
    let longest = 0;
    for (const c of columns) {
      if (c === date || dateLike(c) || amountLike(c)) continue;
      const length = sample.reduce((sum, row) => sum + (row[c]?.trim().length ?? 0), 0);
      if (length > longest) [longest, description] = [length, c];
    }
  }

  const debit = byHeader(DEBIT_HEADER, (c) => c !== date);
  const credit = byHeader(CREDIT_HEADER, (c) => c !== date && c !== debit);
  let amount = byHeader(AMOUNT_HEADER, amountLike);
  if (amount < 0 && !(debit >= 0 && credit >= 0)) {
    amount = columns.find((c) => c !== date && c !== description && amountLike(c)) ?? -1;
  }

  if (amount < 0 && debit >= 0 && credit >= 0) {
    return { headerRow, date, description, amount: { kind: 'split', debit, credit } };
  }
  return {
    headerRow,
    date,
    description,
    amount: { kind: 'single', column: amount, spending: guessSpendingSign(sample, amount) },
  };
}

/** Most bank exports write spending as negative; card exports often as positive. */
function guessSpendingSign(sample: CsvTable, column: number): 'negative' | 'positive' {
  if (column < 0) return 'negative';
  let negative = 0;
  let positive = 0;
  for (const row of sample) {
    const amount = parseAmount(row[column] ?? '');
    if (amount === null || amount === 0) continue;
    if (amount < 0) negative++;
    else positive++;
  }
  return positive > negative ? 'positive' : 'negative';
}

/** First row with no date in it, when the row after it has one; -1 when the file has no header. */
function findHeaderRow(table: CsvTable): number {
  const limit = Math.min(table.length - 1, HEADER_SEARCH_ROWS);
  const hasDate = (row: readonly string[]) => row.some((cell) => parseDate(cell) !== null);
  if (table[0] && hasDate(table[0])) return -1;
  for (let i = 0; i < limit; i++) {
    const row = table[i]!;
    const filled = row.filter((cell) => cell.trim() !== '').length;
    if (filled >= 2 && !hasDate(row) && hasDate(table[i + 1]!)) return i;
  }
  return 0;
}

/**
 * Display names for the columns of a file: header names when there is a header, otherwise
 * "Column 1", "Column 2", ...
 */
export function columnLabels(table: CsvTable, headerRow: number): string[] {
  const width = Math.max(0, ...table.slice(0, 50).map((row) => row.length));
  return [...Array(width).keys()].map((c) => {
    const name = headerRow >= 0 ? (table[headerRow]?.[c]?.trim() ?? '') : '';
    return name !== '' ? name : `Column ${c + 1}`;
  });
}

/** True when the mapping names every column it needs. */
export function isCompleteMapping(mapping: ColumnMapping): boolean {
  const { amount } = mapping;
  const amountOk =
    amount.kind === 'single' ? amount.column >= 0 : amount.debit >= 0 && amount.credit >= 0;
  return mapping.date >= 0 && mapping.description >= 0 && amountOk;
}

/** Data rows after the header. */
export function dataRows(table: CsvTable, plan: ImportPlan): CsvTable {
  const headerRow = plan.kind === 'format' ? plan.headerRow : plan.mapping.headerRow;
  return table.slice(headerRow + 1);
}

/**
 * Reads the transactions out of a parsed file. Invalid rows are counted, never echoed. Each row
 * gets a stable id from its layout, card, day, signed amount, description and how many identical
 * rows came before it in the file (two $5 coffees on one day are two transactions).
 */
export function readRows(table: CsvTable, plan: ImportPlan): ReadResult {
  const rows = dataRows(table, plan);
  const reader = rowReader(table, plan);
  const source = plan.kind === 'format' ? plan.format.id : 'generic';
  const issuerId = plan.kind === 'format' ? plan.format.issuerId : undefined;
  const seen = new Map<string, number>();
  const out: ImportRow[] = [];
  let skipped = 0;

  for (const cells of rows) {
    const raw = reader(cells);
    if (raw === 'skip') {
      skipped++;
      continue;
    }
    const date = parseDate(raw.date);
    if (!date || raw.amount === null || raw.amount === 0) {
      skipped++;
      continue;
    }
    const description = raw.description
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_DESCRIPTION_LENGTH);
    const day = dayKey(date);
    const base = [source, raw.last4 ?? '', day, raw.amount, description.toLowerCase()].join('|');
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);

    out.push({
      id: rowIdFor(`${base}|${occurrence}`),
      day,
      occurredAt: localNoonIso(date),
      amountMinor: Math.abs(raw.amount),
      direction: raw.amount < 0 ? 'debit' : 'credit',
      description,
      ...(issuerId ? { issuerId } : {}),
      ...(raw.last4 ? { accountLast4: raw.last4 } : {}),
      ...(raw.transfer ? { transfer: true } : {}),
    });
  }
  return { rows: out, total: rows.length, skipped };
}

function rowReader(table: CsvTable, plan: ImportPlan): (cells: string[]) => RawRow | 'skip' {
  if (plan.kind === 'format') {
    const { format, headerRow } = plan;
    const names =
      headerRow >= 0
        ? table[headerRow]!.map(normalizeHeader)
        : 'columns' in format
          ? (format as typeof WELLS_FARGO).columns
          : [];
    const index = new Map<string, number>();
    names.forEach((name, i) => {
      if (!index.has(name)) index.set(name, i);
    });
    return (cells) =>
      format.read((name) => {
        const i = index.get(name);
        return i === undefined ? '' : (cells[i] ?? '').trim();
      });
  }
  const { mapping } = plan;
  const cell = (cells: string[], i: number) => (cells[i] ?? '').trim();
  return (cells) => ({
    date: cell(cells, mapping.date),
    description: cell(cells, mapping.description),
    amount:
      mapping.amount.kind === 'single'
        ? signedAmount(cell(cells, mapping.amount.column), mapping.amount.spending)
        : splitAmount(cell(cells, mapping.amount.debit), cell(cells, mapping.amount.credit)),
  });
}
