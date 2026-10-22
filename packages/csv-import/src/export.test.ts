import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { buildExportCsv, categoryName, formatAmount, type ExportTransaction } from './export';

const base: ExportTransaction = {
  occurredAt: new Date(2026, 9, 14, 9, 30).toISOString(),
  merchantName: 'Blue Bottle Coffee',
  merchantRaw: 'SQ *BLUE BOTTLE COFFEE',
  categoryId: 'food.coffee',
  amountMinor: 575,
  currency: 'USD',
  kind: 'expense',
  status: 'confirmed',
  source: 'android_notification',
  note: null,
};

describe('buildExportCsv', () => {
  it('writes a header and one row per transaction, oldest first', () => {
    const csv = buildExportCsv([
      {
        ...base,
        occurredAt: new Date(2026, 9, 15, 23, 50).toISOString(),
        merchantName: null,
        merchantRaw: 'ZQX HOLDINGS, LLC',
        categoryId: 'other.general',
        amountMinor: 4000,
        status: 'needs_review',
        source: 'csv_import',
        note: 'gift for "Sam"\nsecond line',
      },
      base,
      {
        ...base,
        occurredAt: new Date(2026, 9, 13, 12).toISOString(),
        merchantName: 'Example Corp',
        categoryId: 'other.general',
        amountMinor: 250000,
        kind: 'income',
        source: 'manual',
      },
      {
        ...base,
        occurredAt: new Date(2026, 9, 13, 13).toISOString(),
        merchantName: '=cmd()',
        categoryId: 'custom.kids_stuff',
        amountMinor: 105,
        kind: 'refund',
        source: 'share_image',
      },
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(parseCsv(csv)).toEqual([
      ['Date', 'Merchant', 'Category', 'Amount', 'Currency', 'Kind', 'Status', 'Source', 'Note'],
      [
        '2026-10-13',
        'Example Corp',
        '',
        '2500.00',
        'USD',
        'Income',
        'Confirmed',
        'Added by hand',
        '',
      ],
      [
        '2026-10-13',
        "'=cmd()",
        'kids stuff',
        '1.05',
        'USD',
        'Refund',
        'Confirmed',
        'Screenshot',
        '',
      ],
      [
        '2026-10-14',
        'Blue Bottle Coffee',
        'Coffee',
        '5.75',
        'USD',
        'Expense',
        'Confirmed',
        'Bank notification',
        '',
      ],
      [
        '2026-10-15',
        'ZQX HOLDINGS, LLC',
        'Other',
        '40.00',
        'USD',
        'Expense',
        'Needs review',
        'CSV import',
        'gift for "Sam"\nsecond line',
      ],
    ]);
  });

  it('writes just the header when there is nothing to export', () => {
    expect(parseCsv(buildExportCsv([]))).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('formats cents and names categories from the taxonomy', () => {
    expect(formatAmount(5)).toBe('0.05');
    expect(formatAmount(123456)).toBe('1234.56');
    expect(categoryName('bills.utilities')).toBe('Bills & Utilities');
  });
});
