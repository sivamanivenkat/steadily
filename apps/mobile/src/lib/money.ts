/** Amounts are integer cents (USD for the US launch). */

const withCents = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const wholeDollars = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * "$5.75", "$1,284". `cents: 'auto'` drops ".00" on whole amounts (headline figures);
 * `'always'` keeps two decimals (rows, so columns line up).
 */
export function formatMoney(amountCents: number, opts: { cents?: 'auto' | 'always' } = {}): string {
  const dollars = amountCents / 100;
  const whole = Number.isInteger(dollars);
  return (opts.cents ?? 'always') === 'auto' && whole
    ? wholeDollars.format(dollars)
    : withCents.format(dollars);
}

/**
 * Screen-reader version of free text: every "$1,234.56" becomes "1,234 dollars and 56 cents" so
 * answers are voiced as currency rather than digits and symbols.
 */
export function spokenText(text: string): string {
  return text.replace(
    /(-)?\$(\d[\d,]*)(?:\.(\d{1,2}))?/g,
    (_match, minus: string | undefined, whole: string, frac: string | undefined) => {
      const cents =
        Number(whole.replace(/,/g, '')) * 100 + Number((frac ?? '').padEnd(2, '0') || 0);
      return spokenMoney(minus ? -cents : cents);
    },
  );
}

/** Largest whole-dollar part accepted by `parseAmountInput` (keeps budgets sane). */
const MAX_INPUT_DOLLAR_DIGITS = 7;

/**
 * Cleans what the user typed into an amount field: digits and one decimal point, at most two
 * decimals, no leading zeros, thousands separators added. Returns the text to show (without the
 * "$", which sits beside the field) and the value in cents.
 *
 * "1250.5" -> { display: "1,250.5", cents: 125050 }
 */
export function parseAmountInput(raw: string): { display: string; cents: number } {
  const stripped = raw.replace(/[^0-9.]/g, '');
  const dot = stripped.indexOf('.');
  const hasDot = dot !== -1;
  let whole = hasDot ? stripped.slice(0, dot) : stripped;
  const decimals = hasDot
    ? stripped
        .slice(dot + 1)
        .replace(/\./g, '')
        .slice(0, 2)
    : '';

  whole = whole.replace(/^0+(?=\d)/, '').slice(0, MAX_INPUT_DOLLAR_DIGITS);
  if (hasDot && whole === '') whole = '0';

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const display = hasDot ? `${grouped}.${decimals}` : grouped;
  const cents = (Number(whole || '0') * 100 + Number(decimals.padEnd(2, '0'))) | 0;
  return { display, cents };
}

/** Text to prefill an amount field from cents: 30000 -> "300", 12550 -> "125.50". */
export function amountInputFromCents(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return rest === 0 ? grouped : `${grouped}.${String(rest).padStart(2, '0')}`;
}

/** Most digits a cents-first amount field takes (up to $9,999,999.99). */
const MAX_CENTS_DIGITS = 9;

/**
 * Cents-first entry for a number pad: every digit typed shifts in from the right, so "4", "5",
 * "2", "0" reads $0.04, $0.45, $4.52, $45.20. Non-digits are ignored.
 *
 * "45.20" -> 4520, "1,234.5" -> 12345
 */
export function centsFromDigits(text: string): number {
  const digits = text.replace(/\D/g, '').replace(/^0+/, '').slice(0, MAX_CENTS_DIGITS);
  return digits === '' ? 0 : Number(digits);
}

/** Text for a cents-first field: 4520 -> "45.20", 123456 -> "1,234.56", 0 -> "". */
export function centsInputText(cents: number): string {
  if (cents <= 0) return '';
  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${whole}.${String(cents % 100).padStart(2, '0')}`;
}

/**
 * Screen-reader text for an amount: "45 dollars and 20 cents". Screen readers voice the digits
 * as words, so this reads "forty-five dollars and twenty cents".
 */
export function spokenMoney(amountCents: number): string {
  const sign = amountCents < 0 ? 'minus ' : '';
  const abs = Math.abs(Math.round(amountCents));
  const dollars = Math.floor(abs / 100);
  const cents = abs % 100;
  const dollarPart = `${dollars.toLocaleString('en-US')} ${dollars === 1 ? 'dollar' : 'dollars'}`;
  if (cents === 0) return `${sign}${dollarPart}`;
  return `${sign}${dollarPart} and ${cents} ${cents === 1 ? 'cent' : 'cents'}`;
}
