import { getBuiltInCategory, isBuiltInCategoryId } from '@steadily/taxonomy';

import { csvCell, joinCsvRows } from './csv';
import { localDayKey } from './values';

/** The fields of a stored transaction that go into an export. */
export type ExportTransaction = {
  occurredAt: string;
  merchantName: string | null;
  merchantRaw: string | null;
  categoryId: string;
  amountMinor: number;
  currency: string;
  kind: 'expense' | 'income' | 'transfer' | 'refund';
  status: 'confirmed' | 'needs_review';
  source: string;
  note: string | null;
};

export const EXPORT_HEADER = [
  'Date',
  'Merchant',
  'Category',
  'Amount',
  'Currency',
  'Kind',
  'Status',
  'Source',
  'Note',
] as const;

const KIND_LABEL: Record<ExportTransaction['kind'], string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
  refund: 'Refund',
};

const STATUS_LABEL: Record<ExportTransaction['status'], string> = {
  confirmed: 'Confirmed',
  needs_review: 'Needs review',
};

const SOURCE_LABEL: Record<string, string> = {
  android_notification: 'Bank notification',
  ios_sms_shortcut: 'Text alert',
  ios_apple_pay_shortcut: 'Apple Pay',
  share_text: 'Shared text',
  share_image: 'Screenshot',
  share_pdf: 'Shared PDF',
  csv_import: 'CSV import',
  manual: 'Added by hand',
};

/** "Coffee" for built-in ids, the readable tail for custom ones ("custom.kids_stuff" -> "kids stuff"). */
export function categoryName(id: string): string {
  if (isBuiltInCategoryId(id)) return getBuiltInCategory(id).name;
  return id.replace(/^custom\./, '').replace(/_/g, ' ');
}

/** 1234 -> "12.34" (always positive; the Kind column says which way the money went). */
export function formatAmount(amountMinor: number): string {
  const cents = Math.abs(amountMinor);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/**
 * The export file: a header and one row per transaction, oldest first, dates as local
 * "YYYY-MM-DD". Spending categories only apply to expenses and refunds, so income and transfers
 * leave Category empty. UTF-8 with a byte-order mark so spreadsheet apps read accents correctly.
 */
export function buildExportCsv(transactions: readonly ExportTransaction[]): string {
  const sorted = [...transactions].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const rows = sorted.map((tx) => [
    csvCell(localDayKey(tx.occurredAt), true),
    csvCell(tx.merchantName ?? tx.merchantRaw ?? ''),
    csvCell(tx.kind === 'expense' || tx.kind === 'refund' ? categoryName(tx.categoryId) : ''),
    csvCell(formatAmount(tx.amountMinor), true),
    csvCell(tx.currency),
    csvCell(KIND_LABEL[tx.kind]),
    csvCell(STATUS_LABEL[tx.status]),
    csvCell(SOURCE_LABEL[tx.source] ?? tx.source),
    csvCell(tx.note ?? ''),
  ]);
  return `﻿${joinCsvRows([EXPORT_HEADER.map((h) => csvCell(h)), ...rows])}`;
}
