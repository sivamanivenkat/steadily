import {
  dateTimeLabel,
  dayHeading,
  dayKey,
  formatTime,
  monthRange,
  relativeTimeLabel,
} from '../dates';

const now = new Date(2026, 9, 15, 9, 30);

describe('date labels', () => {
  it('names days relative to today', () => {
    expect(dayHeading(new Date(2026, 9, 15, 7, 0), now)).toBe('Today');
    expect(dayHeading(new Date(2026, 9, 14, 23, 59), now)).toBe('Yesterday');
    expect(dayHeading(new Date(2026, 9, 13, 8, 0), now)).toBe('Tuesday, Oct 13');
  });

  it('uses a plain space before AM/PM', () => {
    expect(formatTime(new Date(2026, 9, 15, 8, 42))).toBe('8:42 AM');
    expect(dateTimeLabel(new Date(2026, 9, 14, 15, 12))).toBe('Oct 14 · 3:12 PM');
  });

  it('gives rows a short "when"', () => {
    expect(relativeTimeLabel(new Date(2026, 9, 15, 8, 42), now)).toBe('8:42 AM');
    expect(relativeTimeLabel(new Date(2026, 9, 14, 8, 42), now)).toBe('Yesterday');
    expect(relativeTimeLabel(new Date(2026, 9, 2, 8, 42), now)).toBe('Oct 2');
  });

  it('builds local month ranges and day keys', () => {
    const range = monthRange(now);
    expect(new Date(range.from)).toEqual(new Date(2026, 9, 1));
    expect(new Date(range.to)).toEqual(new Date(2026, 10, 1));
    expect(dayKey(new Date(2026, 0, 5, 23, 0))).toBe('2026-01-05');
  });
});
