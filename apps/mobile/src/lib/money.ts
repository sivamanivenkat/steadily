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
