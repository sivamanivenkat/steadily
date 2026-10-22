import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import type { FormatId } from './formats';
import {
  columnLabels,
  detectFormat,
  guessMapping,
  isCompleteMapping,
  readRows,
  type ImportPlan,
  type ImportRow,
} from './read';

// Synthetic fixtures: made-up merchants, people and card endings.
function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}.csv`, import.meta.url), 'utf8');
}

function read(name: string) {
  const table = parseCsv(fixture(name));
  const plan = detectFormat(table);
  if (!plan) throw new Error(`no format detected for ${name}`);
  return { plan, ...readRows(table, plan) };
}

/** The fields a test cares about: day, signed cents (money out negative), description, flags. */
function summary(rows: readonly ImportRow[]) {
  return rows.map((r) => [
    r.day,
    r.direction === 'debit' ? -r.amountMinor : r.amountMinor,
    r.description,
    ...(r.transfer ? ['transfer'] : []),
    ...(r.accountLast4 ? [r.accountLast4] : []),
  ]);
}

const formatId = (plan: ImportPlan) => (plan.kind === 'format' ? plan.format.id : null);

describe('known layouts', () => {
  const cases: [string, FormatId, string, (string | number)[][], number][] = [
    [
      'chase_card',
      'chase_card',
      'chase',
      [
        ['2026-10-14', -575, 'SQ *BLUE BOTTLE COFFEE'],
        ['2026-10-12', -4000, 'ZQX HOLDINGS, LLC'],
        ['2026-10-10', 50000, 'AUTOMATIC PAYMENT - THANK', 'transfer'],
        ['2026-10-09', 1250, 'EXAMPLE OUTFITTERS'],
        ['2026-10-08', -575, 'SQ *BLUE BOTTLE COFFEE'],
        ['2026-10-08', -575, 'SQ *BLUE BOTTLE COFFEE'],
      ],
      0,
    ],
    [
      'chase_checking',
      'chase_checking',
      'chase',
      [
        ['2026-10-14', -6218, 'EXAMPLE MARKET #123 SPRINGFIELD'],
        ['2026-10-13', 250000, 'EXAMPLE CORP PAYROLL'],
        ['2026-10-12', -50000, 'CHASE CREDIT CRD AUTOPAY', 'transfer'],
        ['2026-10-11', -10000, 'Online Transfer to SAV ...0000', 'transfer'],
      ],
      0,
    ],
    [
      'bofa_checking',
      'bofa_checking',
      'bank_of_america',
      [
        ['2026-10-02', -6218, 'EXAMPLE GROCER 0042 DES:PURCHASE'],
        ['2026-10-05', 250000, 'EXAMPLE CORP DES:PAYROLL'],
        ['2026-10-07', -10000, 'EXAMPLE UTILITY CO DES:BILL PAY'],
      ],
      1,
    ],
    [
      'bofa_card',
      'bofa_card',
      'bank_of_america',
      [
        ['2026-10-14', -1899, 'EXAMPLE BOOKS 0001'],
        ['2026-10-10', 25000, 'PAYMENT - THANK YOU', 'transfer'],
      ],
      0,
    ],
    [
      'capital_one',
      'capital_one',
      'capital_one',
      [
        ['2026-10-14', -2340, 'EXAMPLE PIZZA CO', '1234'],
        ['2026-10-12', 30000, 'CAPITAL ONE MOBILE PYMT', 'transfer', '1234'],
        ['2026-10-11', 1500, 'EXAMPLE OUTFITTERS', '1234'],
      ],
      0,
    ],
    [
      'amex',
      'amex',
      'amex',
      [
        ['2026-10-14', -3200, 'EXAMPLE THEATER 0001', '1005'],
        ['2026-10-13', 45000, 'AUTOPAY PAYMENT - THANK YOU', 'transfer', '1005'],
        ['2026-10-12', 8910, 'EXAMPLE AIR, INC.', '1005'],
      ],
      0,
    ],
    [
      'citi',
      'citi',
      'citi',
      [
        ['2026-10-14', -5410, 'EXAMPLE HARDWARE 0099'],
        ['2026-10-13', 30000, 'PAYMENT THANK YOU', 'transfer'],
      ],
      1,
    ],
    [
      'discover',
      'discover',
      'discover',
      [
        ['2026-10-14', -4102, 'EXAMPLE GAS 0042 SPRINGFIELD IL'],
        ['2026-10-11', 20000, 'INTERNET PAYMENT - THANK YOU', 'transfer'],
      ],
      0,
    ],
    [
      'wells_fargo',
      'wells_fargo',
      'wells_fargo',
      [
        ['2026-10-14', -2745, 'PURCHASE AUTHORIZED ON 10/13 EXAMPLE PHARMACY S000000000 CARD 0000'],
        ['2026-10-13', 120000, 'EXAMPLE CORP DIR DEP'],
        ['2026-10-12', -999, 'CHECK # 1001'],
      ],
      0,
    ],
    [
      'us_bank',
      'us_bank',
      'us_bank',
      [
        ['2026-10-14', -1420, 'EXAMPLE BURGER 042'],
        ['2026-10-13', 90000, 'ELECTRONIC DEPOSIT EXAMPLE CORP'],
      ],
      0,
    ],
    [
      'apple_card',
      'apple_card',
      'apple_card',
      [
        ['2026-10-14', -650, 'Example Tea House'],
        ['2026-10-12', 15000, 'Payment', 'transfer'],
        ['2026-10-11', 2000, 'Example Apparel'],
      ],
      0,
    ],
    [
      'venmo',
      'venmo',
      'venmo',
      [
        ['2026-10-14', -1200, 'Sam Example'],
        ['2026-10-13', 45000, 'Jordan Example'],
        ['2026-10-12', -40000, 'Standard Transfer', 'transfer'],
      ],
      // Pending payment, opening and closing balance lines.
      3,
    ],
    [
      'paypal',
      'paypal',
      'paypal',
      [
        ['2026-10-14', -2500, 'Example Shop'],
        ['2026-10-12', 3000, 'Jordan Example'],
        ['2026-10-10', -3000, 'General Withdrawal', 'transfer'],
      ],
      // The card deposit mirroring the purchase, and the EUR payment.
      2,
    ],
  ];

  it.each(cases)('%s', (name, id, issuerId, expected, skipped) => {
    const result = read(name);
    expect(formatId(result.plan)).toBe(id);
    expect(summary(result.rows)).toEqual(expected);
    expect(result.skipped).toBe(skipped);
    for (const row of result.rows) {
      expect(row.issuerId).toBe(issuerId);
      expect(row.amountMinor).toBeGreaterThan(0);
      const [y, m, d] = row.day.split('-').map(Number) as [number, number, number];
      expect(row.occurredAt).toBe(new Date(y, m - 1, d, 12).toISOString());
    }
  });

  it('reads the same with a byte-order mark and CRLF line endings', () => {
    const lf = fixture('chase_card');
    const crlf = `﻿${lf.replace(/\n/g, '\r\n')}`;
    const a = readRows(parseCsv(lf), detectFormat(parseCsv(lf))!);
    const b = readRows(parseCsv(crlf), detectFormat(parseCsv(crlf))!);
    expect(b).toEqual(a);
  });

  it('does not mistake a plain Date/Description/Amount file for a known layout', () => {
    expect(detectFormat(parseCsv('Date,Description,Amount\n10/14/2026,EXAMPLE,-5.00'))).toBeNull();
  });
});

describe('row ids', () => {
  it('are UUIDs, stable across reads, distinct for identical rows', () => {
    const first = read('chase_card').rows;
    const again = read('chase_card').rows;
    expect(again.map((r) => r.id)).toEqual(first.map((r) => r.id));
    expect(new Set(first.map((r) => r.id)).size).toBe(first.length);
    for (const { id } of first) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it('match between overlapping exports of the same account', () => {
    const lines = fixture('chase_card').trim().split('\n');
    const header = lines[0]!;
    const older = [header, ...lines.slice(2)].join('\n');
    const newer = lines.slice(0, 3).join('\n');
    const ids = (text: string) => {
      const table = parseCsv(text);
      return readRows(table, detectFormat(table)!).rows.map((r) => r.id);
    };
    const all = ids(fixture('chase_card'));
    expect(ids(newer)).toEqual(all.slice(0, 2));
    expect(ids(older)).toEqual(all.slice(1));
  });
});

describe('column mapping fallback', () => {
  it('guesses split debit/credit columns from headers', () => {
    const table = parseCsv(fixture('generic'));
    expect(detectFormat(table)).toBeNull();
    const mapping = guessMapping(table);
    expect(mapping).toEqual({
      headerRow: 0,
      date: 0,
      description: 1,
      amount: { kind: 'split', debit: 2, credit: 3 },
    });
    expect(isCompleteMapping(mapping)).toBe(true);
    expect(columnLabels(table, mapping.headerRow)).toEqual([
      'Posted On',
      'Payee Name',
      'Money Out',
      'Money In',
      'Balance',
    ]);
    const result = readRows(table, { kind: 'mapping', mapping });
    expect(summary(result.rows)).toEqual([
      ['2026-10-14', -450, 'EXAMPLE COFFEE ROASTERS'],
      ['2026-10-13', 100000, 'EXAMPLE CORP PAYROLL'],
      ['2026-10-12', -102000, 'EXAMPLE GARDEN SUPPLY'],
    ]);
    expect(result.rows.every((r) => r.issuerId === undefined)).toBe(true);
  });

  it('guesses columns and the sign convention without a header', () => {
    const table = parseCsv(
      '10/14/2026,EXAMPLE KIOSK,3.00\n10/13/2026,EXAMPLE CINEMA,12.50\n10/12/2026,REFUND EXAMPLE,-4.00\n',
    );
    const mapping = guessMapping(table);
    expect(mapping).toEqual({
      headerRow: -1,
      date: 0,
      description: 1,
      amount: { kind: 'single', column: 2, spending: 'positive' },
    });
    expect(columnLabels(table, -1)).toEqual(['Column 1', 'Column 2', 'Column 3']);
    expect(summary(readRows(table, { kind: 'mapping', mapping }).rows)).toEqual([
      ['2026-10-14', -300, 'EXAMPLE KIOSK'],
      ['2026-10-13', -1250, 'EXAMPLE CINEMA'],
      ['2026-10-12', 400, 'REFUND EXAMPLE'],
    ]);
  });

  it('prefers the transaction date and reads negative spending', () => {
    const table = parseCsv(
      'Post Date,Transaction Date,Description,Amount\n10/15/2026,10/14/2026,EXAMPLE,-5.00\n10/15/2026,10/13/2026,EXAMPLE 2,-6.00\n',
    );
    const mapping = guessMapping(table);
    expect(mapping).toMatchObject({
      date: 1,
      description: 2,
      amount: { kind: 'single', column: 3, spending: 'negative' },
    });
  });

  it('applies a user-chosen mapping and counts unreadable rows', () => {
    const table = parseCsv(
      'When,What,How much\n10/14/2026,EXAMPLE,5\nsoon,EXAMPLE,5\n10/12/2026,EXAMPLE,n/a\n10/11/2026,ZERO,0\n',
    );
    const result = readRows(table, {
      kind: 'mapping',
      mapping: {
        headerRow: 0,
        date: 0,
        description: 1,
        amount: { kind: 'single', column: 2, spending: 'positive' },
      },
    });
    expect(summary(result.rows)).toEqual([['2026-10-14', -500, 'EXAMPLE']]);
    expect(result).toMatchObject({ total: 4, skipped: 3 });
  });

  it('reports an incomplete mapping', () => {
    expect(
      isCompleteMapping({
        headerRow: 0,
        date: 0,
        description: -1,
        amount: { kind: 'single', column: 2, spending: 'negative' },
      }),
    ).toBe(false);
  });
});
