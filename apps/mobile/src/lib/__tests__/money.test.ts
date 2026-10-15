import { formatMoney, spokenMoney } from '../money';

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
});
