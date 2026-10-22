import { parseAmount, parseDate } from './values';

/**
 * Bank and card export layouts recognised by their header row. Every layout here is described
 * from the banks' public "download transactions" help pages; fixtures are synthetic.
 */
export type FormatId =
  | 'chase_card'
  | 'chase_checking'
  | 'bofa_card'
  | 'bofa_checking'
  | 'capital_one'
  | 'amex'
  | 'citi'
  | 'discover'
  | 'wells_fargo'
  | 'us_bank'
  | 'apple_card'
  | 'venmo'
  | 'paypal';

/** Reads a cell of the current row by (normalized) header name; '' when absent. */
export type CellGetter = (header: string) => string;

/**
 * One row as the layout reads it, before validation. `amount` is signed whole cents with money
 * out negative (null when unreadable).
 */
export type RawRow = {
  date: string;
  description: string;
  amount: number | null;
  last4?: string;
  /** Not spending or income: a card payment or a move between the user's own accounts. */
  transfer?: boolean;
};

export type CsvFormat = {
  id: FormatId;
  /** Shown in the preview, e.g. "Chase credit card". */
  name: string;
  /** Rule-pack issuer id, so P2P and dedupe rules apply like they do for alerts. */
  issuerId: string;
  /** Header cells (normalized) that must all be present. */
  requires: readonly string[];
  /** At least one of these must also be present. */
  anyOf?: readonly string[];
  /** `'skip'` for rows the layout leaves out on purpose (pending, balances, holds). */
  read(get: CellGetter): RawRow | 'skip';
};

/** Lowercase, single spaces, no surrounding quotes or byte-order mark. */
export function normalizeHeader(cell: string): string {
  return cell.replace(/^﻿/, '').trim().replace(/^"|"$/g, '').replace(/\s+/g, ' ').toLowerCase();
}

/** Signed cents, money out negative, from one amount column. */
export function signedAmount(text: string, spending: 'negative' | 'positive'): number | null {
  const amount = parseAmount(text);
  if (amount === null) return null;
  return spending === 'negative' ? amount : -amount;
}

/** Signed cents, money out negative, from separate debit and credit columns (signs ignored). */
export function splitAmount(debit: string, credit: string): number | null {
  const out = debit.trim() === '' ? null : parseAmount(debit);
  const into = credit.trim() === '' ? null : parseAmount(credit);
  if (out !== null && out !== 0) return -Math.abs(out);
  if (into !== null && into !== 0) return Math.abs(into);
  if (out === 0 || into === 0) return 0;
  return null;
}

/** A card bill payment as card issuers describe it ("AUTOPAY PAYMENT - THANK YOU"). */
const CARD_PAYMENT =
  /\bpayment\b.*\b(?:thank|received)\b|\b(?:automatic|autopay|auto pay|online|mobile|electronic|internet|ach|e)\s*-?\s*(?:payment|pymt)\b|\bautopay\b/i;

/** On a card statement, money in that is a bill payment is a transfer. */
function cardPayment(description: string, amount: number | null): boolean {
  return amount !== null && amount > 0 && CARD_PAYMENT.test(description);
}

/** "-12345" or "XXXX1234" -> "1234". Only when the cell carries at least 4 digits. */
function lastFour(cell: string): string | undefined {
  const digits = cell.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

/** A card statement row; bill payments become transfers. */
function card(
  date: string,
  description: string,
  amount: number | null,
  extra: { transfer?: boolean; last4?: string | undefined } = {},
): RawRow {
  const transfer = extra.transfer === true || cardPayment(description, amount);
  return {
    date,
    description,
    amount,
    ...(extra.last4 ? { last4: extra.last4 } : {}),
    ...(transfer ? { transfer: true } : {}),
  };
}

export const FORMATS: readonly CsvFormat[] = [
  {
    id: 'apple_card',
    name: 'Apple Card',
    issuerId: 'apple_card',
    requires: [
      'transaction date',
      'clearing date',
      'description',
      'merchant',
      'type',
      'amount (usd)',
    ],
    read: (get) =>
      card(
        get('transaction date'),
        get('merchant') || get('description'),
        signedAmount(get('amount (usd)'), 'positive'),
        { transfer: get('type').toLowerCase() === 'payment' },
      ),
  },
  {
    id: 'chase_card',
    name: 'Chase credit card',
    issuerId: 'chase',
    requires: ['transaction date', 'post date', 'description', 'type', 'amount'],
    read: (get) =>
      card(get('transaction date'), get('description'), signedAmount(get('amount'), 'negative'), {
        transfer: get('type').toLowerCase() === 'payment',
      }),
  },
  {
    id: 'chase_checking',
    name: 'Chase checking',
    issuerId: 'chase',
    requires: ['details', 'posting date', 'description', 'amount', 'type'],
    read: (get) => {
      const type = get('type').toUpperCase();
      return {
        date: get('posting date'),
        description: get('description'),
        amount: signedAmount(get('amount'), 'negative'),
        ...(type === 'ACCT_XFER' || type === 'LOAN_PMT' ? { transfer: true } : {}),
      };
    },
  },
  {
    id: 'capital_one',
    name: 'Capital One',
    issuerId: 'capital_one',
    requires: ['transaction date', 'posted date', 'description', 'debit', 'credit'],
    read: (get) => {
      const last4 = lastFour(get('card no.'));
      return card(
        get('transaction date'),
        get('description'),
        splitAmount(get('debit'), get('credit')),
        {
          ...(last4 ? { last4 } : {}),
        },
      );
    },
  },
  {
    id: 'discover',
    name: 'Discover',
    issuerId: 'discover',
    requires: ['trans. date', 'post date', 'description', 'amount'],
    read: (get) =>
      card(get('trans. date'), get('description'), signedAmount(get('amount'), 'positive')),
  },
  {
    id: 'bofa_card',
    name: 'Bank of America credit card',
    issuerId: 'bank_of_america',
    requires: ['posted date', 'reference number', 'payee', 'amount'],
    read: (get) => card(get('posted date'), get('payee'), signedAmount(get('amount'), 'negative')),
  },
  {
    id: 'bofa_checking',
    name: 'Bank of America checking',
    issuerId: 'bank_of_america',
    requires: ['date', 'description', 'amount', 'running bal.'],
    read: (get) => {
      // Opening and closing balance lines carry no transaction.
      if (/^(?:beginning|ending) balance\b/i.test(get('description')) || get('amount') === '') {
        return 'skip';
      }
      return {
        date: get('date'),
        description: get('description'),
        amount: signedAmount(get('amount'), 'negative'),
      };
    },
  },
  {
    id: 'citi',
    name: 'Citi',
    issuerId: 'citi',
    requires: ['status', 'date', 'description', 'debit', 'credit'],
    read: (get) => {
      if (get('status').toLowerCase() === 'pending') return 'skip';
      return card(get('date'), get('description'), splitAmount(get('debit'), get('credit')));
    },
  },
  {
    id: 'us_bank',
    name: 'US Bank',
    issuerId: 'us_bank',
    requires: ['date', 'transaction', 'name', 'memo', 'amount'],
    read: (get) => card(get('date'), get('name'), signedAmount(get('amount'), 'negative')),
  },
  {
    id: 'amex',
    name: 'American Express',
    issuerId: 'amex',
    requires: ['date', 'description', 'amount'],
    anyOf: ['card member', 'account #', 'extended details', 'appears on your statement as'],
    read: (get) => {
      const last4 = lastFour(get('account #'));
      return card(get('date'), get('description'), signedAmount(get('amount'), 'positive'), {
        ...(last4 ? { last4 } : {}),
      });
    },
  },
  {
    id: 'venmo',
    name: 'Venmo',
    issuerId: 'venmo',
    requires: ['id', 'datetime', 'type', 'status', 'from', 'to', 'amount (total)'],
    read: (get) => {
      // Statement summary lines have no id; only finished payments count.
      const status = get('status').toLowerCase();
      if (get('id') === '' || (status !== 'complete' && status !== 'issued')) return 'skip';
      const amount = signedAmount(get('amount (total)'), 'negative');
      const type = get('type');
      // The other person: who was paid, or who paid.
      const counterparty = amount !== null && amount < 0 ? get('to') : get('from');
      return {
        date: get('datetime'),
        description: counterparty || type,
        amount,
        ...(/transfer/i.test(type) ? { transfer: true } : {}),
      };
    },
  },
  {
    id: 'paypal',
    name: 'PayPal',
    issuerId: 'paypal',
    requires: ['date', 'name', 'type', 'status', 'currency'],
    anyOf: ['gross', 'amount'],
    read: (get) => {
      const type = get('type');
      if (get('status').toLowerCase() !== 'completed') return 'skip';
      if (get('currency').toUpperCase() !== 'USD') return 'skip';
      // Holds, conversions and the card or bank pulls that fund a payment mirror another row.
      if (/authori[sz]ation|hold|currency conversion|card deposit|bank deposit/i.test(type)) {
        return 'skip';
      }
      return {
        date: get('date'),
        description: get('name') || type,
        amount: signedAmount(get('gross') || get('amount'), 'negative'),
        ...(/withdrawal|transfer/i.test(type) ? { transfer: true } : {}),
      };
    },
  },
];

/** Wells Fargo exports have no header: date, amount, "*", check number, description. */
export const WELLS_FARGO: CsvFormat & { columns: readonly string[] } = {
  id: 'wells_fargo',
  name: 'Wells Fargo',
  issuerId: 'wells_fargo',
  requires: [],
  columns: ['date', 'amount', 'star', 'check', 'description'],
  read: (get) => ({
    date: get('date'),
    description: get('description'),
    amount: signedAmount(get('amount'), 'negative'),
  }),
};

export function isWellsFargoRow(cells: readonly string[]): boolean {
  return (
    cells.length >= 5 &&
    parseDate(cells[0]!) !== null &&
    parseAmount(cells[1]!) !== null &&
    cells[2]!.trim() === '*'
  );
}

/** The layout whose header this row is, if any. */
export function formatForHeader(cells: readonly string[]): CsvFormat | null {
  const header = new Set(cells.map(normalizeHeader));
  return (
    FORMATS.find(
      (format) =>
        format.requires.every((name) => header.has(name)) &&
        (!format.anyOf || format.anyOf.some((name) => header.has(name))),
    ) ?? null
  );
}
