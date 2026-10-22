import { describe, expect, it } from 'vitest';
import { csvCell, joinCsvRows, parseCsv } from './csv';
import { parseAmount, parseDate } from './values';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, commas and line breaks inside quotes', () => {
    const text = 'a,"b, c","say ""hi""","line\nbreak"\n1,2,3,4\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b, c', 'say "hi"', 'line\nbreak'],
      ['1', '2', '3', '4'],
    ]);
  });

  it('strips a byte-order mark and accepts CRLF, CR and LF', () => {
    expect(parseCsv('﻿Date,Amount\r\n1/2/2026,3\r1/3/2026,4\n1/4/2026,5')).toEqual([
      ['Date', 'Amount'],
      ['1/2/2026', '3'],
      ['1/3/2026', '4'],
      ['1/4/2026', '5'],
    ]);
  });

  it('drops blank lines and keeps empty cells', () => {
    expect(parseCsv('a,,c\n\n,,\r\n\nd,e,\n')).toEqual([
      ['a', '', 'c'],
      ['d', 'e', ''],
    ]);
  });

  it('keeps an unterminated quoted field at the end', () => {
    expect(parseCsv('a,"open field')).toEqual([['a', 'open field']]);
  });

  it('keeps a quoted empty last field', () => {
    expect(parseCsv('a,""')).toEqual([['a', '']]);
  });

  it('detects semicolon and tab delimiters', () => {
    expect(parseCsv('Date;Amount\n1/2/2026;"3,50"')).toEqual([
      ['Date', 'Amount'],
      ['1/2/2026', '3,50'],
    ]);
    expect(parseCsv('Date\tAmount\n1/2/2026\t3')).toEqual([
      ['Date', 'Amount'],
      ['1/2/2026', '3'],
    ]);
  });
});

describe('csvCell / joinCsvRows', () => {
  it('quotes when needed and round-trips through parseCsv', () => {
    const cells = ['plain', 'a, b', 'say "hi"', 'two\nlines'];
    const text = joinCsvRows([cells.map((c) => csvCell(c))]);
    expect(text).toBe('plain,"a, b","say ""hi""","two\nlines"\r\n');
    expect(parseCsv(text)).toEqual([cells]);
  });

  it('defuses spreadsheet formulas in text, not in numbers', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1 555')).toBe("'+1 555");
    expect(csvCell('@sum')).toBe("'@sum");
    expect(csvCell('-12.00', true)).toBe('-12.00');
  });
});

describe('parseAmount', () => {
  it.each([
    ['12.34', 1234],
    ['-12.34', -1234],
    ['$1,234.50', 123450],
    ['(45.20)', -4520],
    ['45.20-', -4520],
    ['- $12.00', -1200],
    ['+ $450.00', 45000],
    ['−12.00', -1200],
    ['USD 5', 500],
    ['.5', 50],
    ['7.', 700],
    ['0.00', 0],
  ])('%s -> %d', (text, cents) => {
    expect(parseAmount(text)).toBe(cents);
  });

  it.each(['', 'abc', '12.345', '1,2', '12a', '--5', '$', '10000000.00'])('rejects %j', (text) => {
    expect(parseAmount(text)).toBeNull();
  });
});

describe('parseDate', () => {
  it.each([
    ['10/15/2026', [2026, 10, 15]],
    ['1/5/26', [2026, 1, 5]],
    ['2026-10-15', [2026, 10, 15]],
    ['2026-10-15T19:05:11', [2026, 10, 15]],
    ['2026/10/15', [2026, 10, 15]],
    ['10-15-2026', [2026, 10, 15]],
    ['Oct 15, 2026', [2026, 10, 15]],
    ['Sept 3 2026', [2026, 9, 3]],
    ['15 Oct 2026', [2026, 10, 15]],
    ['10/15/2026 08:12 AM', [2026, 10, 15]],
  ])('%s', (text, [year, month, day]) => {
    expect(parseDate(text)).toEqual({ year, month, day });
  });

  it.each(['', '2/30/2026', '13/01/2026', '1/1/1980', 'Octopus 1, 2026', 'yesterday', '12345'])(
    'rejects %j',
    (text) => {
      expect(parseDate(text)).toBeNull();
    },
  );
});
