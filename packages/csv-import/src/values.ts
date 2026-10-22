/** A calendar date as written in the file (no time zone). */
export type CalendarDate = { year: number; month: number; day: number };

/** Largest amount accepted from a file: $9,999,999.99, like the Add screen. */
export const MAX_AMOUNT_MINOR = 999_999_999;

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const MONTHS = MONTH_NAMES.map((name) => name.slice(0, 3));

/**
 * A money amount in whole cents, signed as written: "-12.34", "(12.34)", "12.34-", "- $12.34"
 * and "−12.34" are negative; "$1,234.50", "+ $5", "USD 5.00" positive. Null when the text is
 * not an amount (more than two decimals, letters, empty) or is larger than `MAX_AMOUNT_MINOR`.
 */
export function parseAmount(text: string): number | null {
  let s = text.trim().replace(/−/g, '-');
  if (s === '') return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/\b(?:USD|US\$)\b/gi, '').replace(/[$\s]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  } else if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  // Thousands separators only between digit groups: "1,234.56", not "1,2".
  if (/,/.test(s)) {
    if (!/^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/.test(s)) return null;
    s = s.replace(/,/g, '');
  }
  const match = /^(\d*)(?:\.(\d{0,2}))?$/.exec(s);
  if (!match || (match[1] === '' && !match[2])) return null;
  const whole = match[1] === '' ? 0 : Number(match[1]);
  const cents = Number((match[2] ?? '').padEnd(2, '0'));
  const minor = whole * 100 + cents;
  if (!Number.isSafeInteger(minor) || minor > MAX_AMOUNT_MINOR) return null;
  return negative && minor !== 0 ? -minor : minor;
}

/**
 * A date in the formats US banks export: "10/15/2026", "10/15/26", "2026-10-15",
 * "2026-10-15T08:12:00" (time ignored), "10-15-2026", "Oct 15, 2026", "15 Oct 2026".
 * Two-digit years are 20xx. Null for anything else, impossible dates and years outside
 * 1990–2100.
 */
export function parseDate(text: string): CalendarDate | null {
  const s = text.trim();
  let year: number;
  let month: number;
  let day: number;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/.exec(s))) {
    [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})(?:\s.*)?$/.exec(s))) {
    [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (m[3]!.length === 2) year += 2000;
  } else if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s))) {
    month = monthNumber(m[1]!);
    [day, year] = [Number(m[2]), Number(m[3])];
  } else if ((m = /^(\d{1,2})[\s-]([A-Za-z]{3,9})\.?[\s-](\d{4})$/.exec(s))) {
    month = monthNumber(m[2]!);
    [day, year] = [Number(m[1]), Number(m[3])];
  } else {
    return null;
  }
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** "oct", "Sept", "October" -> 10; 0 for anything else. */
function monthNumber(name: string): number {
  const lower = name.toLowerCase();
  const index = MONTHS.indexOf(lower.slice(0, 3));
  if (index < 0) return 0;
  return MONTH_NAMES[index]!.startsWith(lower) || lower === 'sept' ? index + 1 : 0;
}

/** "2026-10-15" */
export function dayKey(date: CalendarDate): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

/**
 * The instant stored for a date-only row: local noon on that day, so it lands on the right day
 * in budgets and lists in any time zone.
 */
export function localNoonIso(date: CalendarDate): string {
  return new Date(date.year, date.month - 1, date.day, 12).toISOString();
}

/** The local calendar day of an instant, as "2026-10-15". */
export function localDayKey(iso: string): string {
  const d = new Date(iso);
  return dayKey({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });
}

/** Whole days from `a` to `b` ("YYYY-MM-DD" keys). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
