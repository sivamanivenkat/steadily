import type { DateRange } from '@/data/types';

/** Calendar helpers in the phone's local time zone. */

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function startOfNextMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

/** The calendar month containing `date`, as `[first day, first day of next month)`. */
export function monthRange(date: Date): DateRange {
  return {
    from: startOfMonth(date).toISOString(),
    to: startOfNextMonth(date).toISOString(),
  };
}

/** From the first day of last month to the end of today. Activity's default window. */
export function recentRange(now: Date): DateRange {
  return {
    from: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(),
    to: addDays(startOfDay(now), 1).toISOString(),
  };
}

/** Local `YYYY-MM-DD`, for grouping by day. */
export function dayKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);
}

// Some ICU versions put a narrow no-break space before AM/PM; use a plain space everywhere.
const clean = (s: string) => s.replace(/[  ]/g, ' ');

const timeFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const shortDateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const dayHeadingFormat = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'short',
  day: 'numeric',
});
const longDateFormat = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});
const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'long' });

/** "8:42 AM" */
export function formatTime(date: Date): string {
  return clean(timeFormat.format(date));
}

/** "Oct 13" */
export function formatShortDate(date: Date): string {
  return clean(shortDateFormat.format(date));
}

/** "Thursday, October 15" */
export function formatLongDate(date: Date): string {
  return clean(longDateFormat.format(date));
}

/** "October" */
export function formatMonth(date: Date): string {
  return monthFormat.format(date);
}

/** Day section heading: "Today", "Yesterday", "Tuesday, Oct 13". */
export function dayHeading(date: Date, now: Date): string {
  const diff = daysBetween(date, now);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return clean(dayHeadingFormat.format(date));
}

/** Short "when" for a row: the time today, "Yesterday", else the date. */
export function relativeTimeLabel(date: Date, now: Date): string {
  const diff = daysBetween(date, now);
  if (diff === 0) return formatTime(date);
  if (diff === 1) return 'Yesterday';
  return formatShortDate(date);
}

/** "Oct 14 · 3:12 PM" */
export function dateTimeLabel(date: Date): string {
  return `${formatShortDate(date)} · ${formatTime(date)}`;
}
