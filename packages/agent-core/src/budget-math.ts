/**
 * Pure budget math shared by the Budget Coach and the app UI (D-015 MVP:
 * category budgets with a pace bar, safe-to-spend).
 *
 * Conventions:
 * - Money is integer minor units (cents); results are integers (rounded down).
 * - Instants are ISO strings or `Date`s; periods are half-open `[start, end)`.
 * - "Local" means the user's time zone: an IANA name ("America/New_York"), a
 *   fixed offset ("-05:00", "+05:30", "Z") or offset minutes east of UTC.
 *   When omitted, the device zone is used.
 */
import type { Transaction } from '@steadily/shared-types';
import type { CategoryId } from '@steadily/taxonomy';
import type { Budget, Subscription } from './ports';

export type TimeZoneInput = string | number;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** The device's IANA zone, or UTC if the runtime cannot tell. */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

const FIXED_OFFSET = /^([+-])(\d{2}):?(\d{2})$/;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    // Throws RangeError for an unknown zone, which is what callers should see.
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Fixed offset in minutes for offset-style inputs, or null for IANA names. */
function fixedOffsetMinutes(zone: TimeZoneInput): number | null {
  if (typeof zone === 'number') return zone;
  if (zone === 'Z' || zone === 'UTC') return 0;
  const match = FIXED_OFFSET.exec(zone);
  if (!match) return null;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

/** Offset of `zone` from UTC at `instantMs`, in minutes (local = UTC + offset). */
export function zoneOffsetMinutes(instantMs: number, zone: TimeZoneInput): number {
  const fixed = fixedOffsetMinutes(zone);
  if (fixed !== null) return fixed;
  const parts: Record<string, number> = {};
  for (const part of formatterFor(zone as string).formatToParts(new Date(instantMs))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  const localAsUtc = Date.UTC(
    parts.year ?? 1970,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  const wholeSeconds = Math.floor(instantMs / 1000) * 1000;
  return Math.round((localAsUtc - wholeSeconds) / MINUTE_MS);
}

export interface LocalDateTime {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Wall-clock fields of an instant in `zone`. */
export function toLocal(instant: Date | string, zone: TimeZoneInput): LocalDateTime {
  const ms = toMs(instant);
  const local = new Date(ms + zoneOffsetMinutes(ms, zone) * MINUTE_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
  };
}

/**
 * The instant at which the wall clock in `zone` shows the given time. If that
 * time does not exist (skipped by a DST jump) it is shifted forward by the
 * length of the gap (02:30 → 03:30, like Temporal's "compatible"); if it exists
 * twice, the earlier instant is returned.
 */
export function fromLocal(local: LocalDateTime, zone: TimeZoneInput): Date {
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const first = asUtc - zoneOffsetMinutes(asUtc, zone) * MINUTE_MS;
  const second = asUtc - zoneOffsetMinutes(first, zone) * MINUTE_MS;
  if (first === second) return new Date(first);
  // Offsets disagree: we are at a transition. Prefer a candidate that maps back
  // to the requested wall time (earlier first); otherwise we are in a gap.
  const candidates = [Math.min(first, second), Math.max(first, second)];
  for (const candidate of candidates) {
    const back = candidate + zoneOffsetMinutes(candidate, zone) * MINUTE_MS;
    if (back === asUtc) return new Date(candidate);
  }
  return new Date(Math.max(first, second));
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export interface BudgetPeriod {
  /** "YYYY-MM" of the local month. */
  key: string;
  /** First instant of the local month (inclusive), ISO UTC. */
  start: string;
  /** First instant of the next local month (exclusive), ISO UTC. */
  end: string;
  /** Calendar days in the month. */
  days: number;
}

/**
 * The local calendar month containing `instant`: from local midnight on the
 * 1st to local midnight on the 1st of the next month. DST months are 1 hour
 * shorter or longer than `days * 24h`, which is why both ends are computed
 * from wall-clock time instead of adding days.
 */
export function monthPeriod(
  instant: Date | string,
  timeZone: TimeZoneInput = deviceTimeZone(),
): BudgetPeriod {
  const { year, month } = toLocal(instant, timeZone);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const start = fromLocal({ year, month, day: 1, hour: 0, minute: 0 }, timeZone);
  const end = fromLocal({ year: nextYear, month: nextMonth, day: 1, hour: 0, minute: 0 }, timeZone);
  return {
    key: `${year}-${String(month).padStart(2, '0')}`,
    start: start.toISOString(),
    end: end.toISOString(),
    days: daysInMonth(year, month),
  };
}

export function isWithin(instant: Date | string, period: Pick<BudgetPeriod, 'start' | 'end'>) {
  const ms = toMs(instant);
  return ms >= Date.parse(period.start) && ms < Date.parse(period.end);
}

// ---------------------------------------------------------------------------
// Spending totals
// ---------------------------------------------------------------------------

export interface SpendingTotals {
  /** Sum of `byCategory`. */
  totalMinor: number;
  /** Net spending per category; categories with no activity are absent. */
  byCategory: ReadonlyMap<CategoryId, number>;
}

/**
 * Spending for a period, per category:
 *
 *   spent(c) = max(0, Σ expenses in c − Σ linked refunds attributed to c)
 *
 * - Counted: non-deleted rows with occurredAt in the period (if given) and the
 *   given currency (if given).
 * - Expenses: kind 'expense' without `linkedTransactionId` (an expense linked to
 *   another row is a duplicate of it and is not counted twice).
 * - Refunds: kind 'refund' with `linkedTransactionId`; attributed to the
 *   original's category when the original is in `transactions`, else to the
 *   refund's own category. Refunds count in the period they occur in (a refund
 *   this month for last month's purchase lowers this month). Unlinked refunds
 *   are ignored until the Reconciler links them.
 * - Income and transfers are excluded.
 * - Each category is floored at 0 so a refund can't make spending negative.
 */
export function spendingTotals(
  transactions: readonly Transaction[],
  options: { period?: Pick<BudgetPeriod, 'start' | 'end'>; currency?: string } = {},
): SpendingTotals {
  const { period, currency } = options;
  const byId = new Map(transactions.map((t) => [t.id, t]));
  const net = new Map<CategoryId, number>();
  const add = (category: CategoryId, amount: number) =>
    net.set(category, (net.get(category) ?? 0) + amount);

  for (const t of transactions) {
    if (t.deletedAt !== null) continue;
    if (currency !== undefined && t.currency !== currency) continue;
    if (period && !isWithin(t.occurredAt, period)) continue;
    if (t.kind === 'expense' && t.linkedTransactionId === null) {
      add(t.categoryId, t.amountMinor);
    } else if (t.kind === 'refund' && t.linkedTransactionId !== null) {
      const original = byId.get(t.linkedTransactionId);
      add(original?.categoryId ?? t.categoryId, -t.amountMinor);
    }
  }

  const byCategory = new Map<CategoryId, number>();
  let totalMinor = 0;
  for (const [category, amount] of net) {
    const floored = Math.max(0, amount);
    byCategory.set(category, floored);
    totalMinor += floored;
  }
  return { totalMinor, byCategory };
}

/** Spending that counts against `budget`: its category, or everything for the overall budget. */
export function spentForBudget(budget: Pick<Budget, 'categoryId'>, totals: SpendingTotals): number {
  return budget.categoryId === null
    ? totals.totalMinor
    : (totals.byCategory.get(budget.categoryId) ?? 0);
}

// ---------------------------------------------------------------------------
// Pace
// ---------------------------------------------------------------------------

export type PaceStatus = 'on_track' | 'a_little_ahead' | 'over';

export interface Pace {
  /** spent / budget × 100. Not capped (120 means 20% over). */
  percentUsed: number;
  /** Share of the period's duration that has passed, 0–100. */
  percentOfPeriodElapsed: number;
  status: PaceStatus;
}

/** Points ahead of the calendar at which spending counts as "a little ahead". */
export const PACE_AHEAD_POINTS = 2;

/**
 * Spending pace for a monthly budget (the pace bar: "60% through month, 72% used").
 *
 *   percentUsed            = spent / budget × 100        (budget ≤ 0: 100 if spent > 0, else 0)
 *   percentOfPeriodElapsed = (now − start) / (end − start) × 100, clamped to 0–100
 *   status = 'over'            if percentUsed ≥ 100
 *          = 'a_little_ahead'  if percentUsed − percentOfPeriodElapsed ≥ 2
 *          = 'on_track'        otherwise
 *
 * The period defaults to the local month containing `now`.
 */
export function paceFor(
  budget: Pick<Budget, 'amountMinor'>,
  spentMinor: number,
  now: Date,
  options: { timeZone?: TimeZoneInput; period?: Pick<BudgetPeriod, 'start' | 'end'> } = {},
): Pace {
  const period = options.period ?? monthPeriod(now, options.timeZone);
  const percentUsed = percentOf(spentMinor, budget.amountMinor);
  const percentOfPeriodElapsed = elapsedPercent(now, period);
  const status: PaceStatus =
    percentUsed >= 100
      ? 'over'
      : percentUsed - percentOfPeriodElapsed >= PACE_AHEAD_POINTS
        ? 'a_little_ahead'
        : 'on_track';
  return { percentUsed, percentOfPeriodElapsed, status };
}

export function percentOf(spentMinor: number, budgetMinor: number): number {
  if (budgetMinor <= 0) return spentMinor > 0 ? 100 : 0;
  return (Math.max(0, spentMinor) / budgetMinor) * 100;
}

export function elapsedPercent(now: Date, period: Pick<BudgetPeriod, 'start' | 'end'>): number {
  const start = Date.parse(period.start);
  const end = Date.parse(period.end);
  if (end <= start) return 100;
  return Math.min(100, Math.max(0, ((now.getTime() - start) / (end - start)) * 100));
}

// ---------------------------------------------------------------------------
// Upcoming subscription charges
// ---------------------------------------------------------------------------

export type Cadence = Subscription['cadence'];

const CADENCE_MONTHS: Record<Exclude<Cadence, 'weekly'>, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/**
 * Next charge after one at `from`: +7 days for weekly, else + N calendar months
 * on the same day of month (clamped, so Jan 31 → Feb 28/29). UTC date
 * arithmetic, time of day kept.
 */
export function addCadence(from: Date | string, cadence: Cadence, times = 1): Date {
  const date = new Date(toMs(from));
  if (cadence === 'weekly') return new Date(date.getTime() + 7 * times * DAY_MS);
  const day = date.getUTCDate();
  const target = new Date(date.getTime());
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + CADENCE_MONTHS[cadence] * times);
  target.setUTCDate(Math.min(day, daysInMonth(target.getUTCFullYear(), target.getUTCMonth() + 1)));
  return target;
}

export interface UpcomingCharge {
  subscriptionId: string;
  amountMinor: number;
  dueAt: string;
}

/**
 * Projected charges with `from ≤ dueAt < to`, starting at each subscription's
 * `nextDueAt` and repeating by cadence (a weekly subscription can charge
 * several times in a month). Due dates already in the past are rolled forward:
 * we assume a missed charge either happened uncaptured or won't come.
 * Dismissed/deleted subscriptions and other currencies are skipped.
 */
export function upcomingCharges(
  subscriptions: readonly Subscription[],
  from: Date | string,
  to: Date | string,
  currency?: string,
): UpcomingCharge[] {
  const fromMs = toMs(from);
  const toMsValue = toMs(to);
  const charges: UpcomingCharge[] = [];
  for (const sub of subscriptions) {
    if (sub.deletedAt !== null || sub.dismissed || sub.nextDueAt === null) continue;
    if (currency !== undefined && sub.currency !== currency) continue;
    // Step from the anchor with a multiplier so month-end days don't drift.
    for (let i = 0; i < 1000; i++) {
      const due = addCadence(sub.nextDueAt, sub.cadence, i).getTime();
      if (due >= toMsValue) break;
      if (due >= fromMs) {
        charges.push({
          subscriptionId: sub.id,
          amountMinor: sub.amountMinor,
          dueAt: new Date(due).toISOString(),
        });
      }
    }
  }
  return charges.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

// ---------------------------------------------------------------------------
// Safe to spend
// ---------------------------------------------------------------------------

export interface SafeToSpendInput {
  /** Monthly income, or the overall monthly budget if the user set one. */
  budgetMinor: number;
  /** Spending so far this period (see `spendingTotals`). */
  spentMinor: number;
  /** Expected charges; only those due in [now, period end) are counted. */
  upcoming: readonly { amountMinor: number; dueAt: string }[];
  now: Date;
  timeZone?: TimeZoneInput;
}

export interface SafeToSpend {
  amountMinor: number;
  perDayMinor: number;
  /** End of the period (exclusive), ISO UTC. */
  until: string;
  /** Local calendar days left including today. */
  daysLeft: number;
}

/**
 * Safe-to-spend for the rest of the local month:
 *
 *   reserved    = Σ upcoming charges with now ≤ dueAt < period end
 *   amount      = max(0, budget − spent − reserved)
 *   daysLeft    = days in month − local day of month + 1   (today counts)
 *   perDay      = floor(amount / daysLeft)
 *   until       = period end
 */
export function safeToSpend(input: SafeToSpendInput): SafeToSpend {
  const timeZone = input.timeZone ?? deviceTimeZone();
  const period = monthPeriod(input.now, timeZone);
  const nowMs = input.now.getTime();
  const endMs = Date.parse(period.end);
  const reserved = input.upcoming
    .filter((c) => {
      const due = Date.parse(c.dueAt);
      return due >= nowMs && due < endMs;
    })
    .reduce((sum, c) => sum + c.amountMinor, 0);
  const amountMinor = Math.max(0, input.budgetMinor - input.spentMinor - reserved);
  const daysLeft = period.days - toLocal(input.now, timeZone).day + 1;
  return {
    amountMinor,
    perDayMinor: Math.floor(amountMinor / daysLeft),
    until: period.end,
    daysLeft,
  };
}

function toMs(instant: Date | string): number {
  const ms = typeof instant === 'string' ? Date.parse(instant) : instant.getTime();
  if (Number.isNaN(ms)) throw new RangeError('Invalid instant');
  return ms;
}
