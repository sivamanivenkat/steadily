import { describe, expect, it } from 'vitest';
import { classifyRows, duplicateWindow, similarMerchant, type ExistingTransaction } from './dedupe';
import type { ImportRow } from './read';

const noon = (day: number) => new Date(2026, 9, day, 12).toISOString();
const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 31).toISOString();

function row(
  id: string,
  day: number,
  amountMinor: number,
  description: string,
  extra: Partial<ImportRow> = {},
): ImportRow {
  return {
    id,
    day: `2026-10-${String(day).padStart(2, '0')}`,
    occurredAt: noon(day),
    amountMinor,
    direction: 'debit',
    description,
    ...extra,
  };
}

function tx(
  id: string,
  occurredAt: string,
  amountMinor: number,
  merchantName: string | null,
  extra: Partial<ExistingTransaction> = {},
): ExistingTransaction {
  return {
    id,
    occurredAt,
    amountMinor,
    kind: 'expense',
    merchantName,
    merchantRaw: merchantName,
    accountLast4: null,
    ...extra,
  };
}

describe('classifyRows', () => {
  it('marks rows imported before, duplicates of alerts, and new rows', () => {
    const rows = [
      row('r1', 14, 575, 'SQ *BLUE BOTTLE COFFEE'),
      row('r2', 12, 4000, 'ZQX HOLDINGS 991'),
      row('r3', 10, 999, 'EXAMPLE NEW SHOP'),
    ];
    const existing = [
      tx('r1', noon(14), 575, 'Blue Bottle Coffee', {}),
      tx('alert', at(11, 19), 4000, 'Zqx Holdings'),
    ];
    expect(classifyRows(rows, new Set(['r1']), existing)).toEqual([
      'already_imported',
      'duplicate',
      'new',
    ]);
  });

  it('matches each stored transaction once, nearest day first', () => {
    const rows = [
      row('a', 8, 575, 'SQ *BLUE BOTTLE COFFEE'),
      row('b', 8, 575, 'SQ *BLUE BOTTLE COFFEE'),
    ];
    const existing = [tx('alert', at(8, 7), 575, 'Blue Bottle Coffee')];
    expect(classifyRows(rows, new Set(), existing)).toEqual(['duplicate', 'new']);
  });

  it('needs the same amount, direction, a close day, card ending and merchant', () => {
    const base = row('r', 14, 2000, 'EXAMPLE PIZZA CO', { accountLast4: '1234' });
    const cases: [ExistingTransaction, boolean][] = [
      [tx('same', at(14, 18), 2000, 'Example Pizza Co'), true],
      [tx('day_before', at(13, 23), 2000, 'Example Pizza'), true],
      [tx('posted_later', at(11, 9), 2000, 'Example Pizza'), true],
      [tx('too_old', at(10, 9), 2000, 'Example Pizza'), false],
      [tx('too_new', at(16, 9), 2000, 'Example Pizza'), false],
      [tx('amount', at(14, 18), 2001, 'Example Pizza'), false],
      [tx('income', at(14, 18), 2000, 'Example Pizza', { kind: 'income' }), false],
      [tx('card', at(14, 18), 2000, 'Example Pizza', { accountLast4: '9999' }), false],
      [tx('merchant', at(14, 18), 2000, 'Another Place'), false],
      [tx('no_merchant', at(14, 18), 2000, null), true],
    ];
    for (const [existing, duplicate] of cases) {
      expect([existing.id, classifyRows([base], new Set(), [existing])[0]]).toEqual([
        existing.id,
        duplicate ? 'duplicate' : 'new',
      ]);
    }
  });

  it('matches credits to income and refunds', () => {
    const credit = row('r', 9, 1250, 'EXAMPLE OUTFITTERS', { direction: 'credit' });
    expect(
      classifyRows([credit], new Set(), [
        tx('refund', at(9, 10), 1250, 'Example Outfitters', { kind: 'refund' }),
      ]),
    ).toEqual(['duplicate']);
    expect(
      classifyRows([credit], new Set(), [tx('spend', at(9, 10), 1250, 'Example Outfitters')]),
    ).toEqual(['new']);
  });
});

describe('duplicateWindow', () => {
  it('covers three days before the first row and a day after the last', () => {
    const window = duplicateWindow([row('a', 14, 1, 'x'), row('b', 8, 1, 'y')])!;
    expect(Date.parse(window.from)).toBeLessThanOrEqual(new Date(2026, 9, 5).getTime());
    expect(Date.parse(window.to)).toBeGreaterThanOrEqual(new Date(2026, 9, 16).getTime());
    expect(duplicateWindow([])).toBeNull();
  });
});

describe('similarMerchant', () => {
  it.each([
    ['starbucks', 'starbucks_store_1234', true],
    ['blue_bottle_coffee', 'blue_bottle', true],
    ['zqx_holdings', 'zqx_holdings_llc', true],
    ['target', 'trader_joes', false],
    ['', 'anything', true],
    ['ab_shop', 'ab_store', false],
  ])('%s ~ %s: %s', (a, b, same) => {
    expect(similarMerchant(a, b)).toBe(same);
  });
});
