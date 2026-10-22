import {
  amountInputFromCents,
  centsFromDigits,
  centsInputText,
  formatMoney,
  parseAmountInput,
  spokenMoney,
} from '../money';

describe('cents-first amount entry', () => {
  it('shifts digits in from the right', () => {
    expect(['4', '45', '452', '4520'].map(centsFromDigits)).toEqual([4, 45, 452, 4520]);
    // What the field shows is fed back in with one more digit or one less.
    expect(centsFromDigits(`${centsInputText(4520)}7`)).toBe(45207);
    expect(centsFromDigits(centsInputText(4520).slice(0, -1))).toBe(452);
    expect(centsFromDigits('')).toBe(0);
    expect(centsFromDigits('0.0')).toBe(0);
    expect(centsFromDigits('99999999999')).toBe(999_999_999);
  });

  it('formats for the field', () => {
    expect(centsInputText(0)).toBe('');
    expect(centsInputText(5)).toBe('0.05');
    expect(centsInputText(4520)).toBe('45.20');
    expect(centsInputText(123456)).toBe('1,234.56');
  });
});

describe('money', () => {
  it('formats cents as USD', () => {
    expect(formatMoney(575)).toBe('$5.75');
    expect(formatMoney(128_400)).toBe('$1,284.00');
    expect(formatMoney(128_400, { cents: 'auto' })).toBe('$1,284');
    expect(formatMoney(1_799, { cents: 'auto' })).toBe('$17.99');
  });

  it('spells amounts for screen readers', () => {
    expect(spokenMoney(4_520)).toBe('45 dollars and 20 cents');
    expect(spokenMoney(100)).toBe('1 dollar');
    expect(spokenMoney(101)).toBe('1 dollar and 1 cent');
    expect(spokenMoney(-575)).toBe('minus 5 dollars and 75 cents');
  });

  it('cleans amount input and adds thousands separators', () => {
    expect(parseAmountInput('')).toEqual({ display: '', cents: 0 });
    expect(parseAmountInput('1250.5')).toEqual({ display: '1,250.5', cents: 125_050 });
    expect(parseAmountInput('$1,250.509')).toEqual({ display: '1,250.50', cents: 125_050 });
    expect(parseAmountInput('007')).toEqual({ display: '7', cents: 700 });
    expect(parseAmountInput('.5')).toEqual({ display: '0.5', cents: 50 });
    expect(parseAmountInput('1.2.3')).toEqual({ display: '1.23', cents: 123 });
    expect(parseAmountInput('abc')).toEqual({ display: '', cents: 0 });
    expect(parseAmountInput('123456789').display).toBe('1,234,567');
  });

  it('prefills amount input from cents', () => {
    expect(amountInputFromCents(30_000)).toBe('300');
    expect(amountInputFromCents(12_550)).toBe('125.50');
    expect(amountInputFromCents(400_000)).toBe('4,000');
    expect(parseAmountInput(amountInputFromCents(123_405)).cents).toBe(123_405);
  });
});
