/**
 * On-device tools for "Ask your money" (D-015, D-011, BUILD_PLAN 2.3).
 *
 * The model (cloud or on-device) never sees the database. It asks for a tool
 * by name; the tool runs here, over the local repos, and only its result goes
 * back. In `cloud` privacy mode results are aggregates: no per-transaction
 * rows, no notes, no raw descriptors, and payments to people are merged into
 * one nameless bucket (D-011 item 8).
 *
 * Amounts are integer minor units (cents) with a currency code. Spending math
 * is `spendingTotals` from budget-math (transfers, income, duplicates and
 * unlinked refunds excluded; linked refunds subtracted).
 */
import { z } from 'zod';
import type { Transaction } from '@steadily/shared-types';
import { lookupMerchant, toMerchantKey } from '@steadily/merchants';
import { CATEGORIES, type CategoryId } from '@steadily/taxonomy';
import { isPaymentToPerson } from '../agents/categorizer';
import {
  fromLocal,
  monthPeriod,
  paceFor,
  spendingTotals,
  spentForBudget,
  toLocal,
  upcomingCharges,
  type BudgetPeriod,
  type PaceStatus,
} from '../budget-math';
import type { Repos } from '../ports';

export type AskPrivacy = 'local' | 'cloud';

export const PEOPLE_BUCKET_NAME = 'Payments to people';
/**
 * Cloud mode only names well-known chains from the merchant dictionary. Local businesses
 * (a clinic, a small shop) can reveal sensitive details, so they share one bucket (D-011).
 */
export const OTHER_MERCHANTS_BUCKET_NAME = 'Other merchants';
export const DEFAULT_ASK_CURRENCY = 'USD';

/** Tool definition in the shape the proxy `ask` request carries. */
export interface AskToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolContext {
  repos: Pick<Repos, 'transactions' | 'budgets' | 'subscriptions'>;
  now: Date;
  /** IANA zone or fixed offset (budget-math TimeZoneInput). */
  timeZone: string;
  privacy: AskPrivacy;
  /** Currency spending is summed in. Defaults to USD. */
  currency?: string;
}

/** Soft cap for one serialized tool result; the proxy allows 16 KB for all of them. */
export const MAX_TOOL_OUTPUT_BYTES = 4 * 1024;
const MAX_CATEGORIES = 30;
const MAX_SUBSCRIPTIONS = 20;
const MAX_COMPARE_CATEGORIES = 8;
const MAX_NAME_CHARS = 60;
const UPCOMING_DAYS = 30;

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export const periodSchema = z.union([
  z.strictObject({
    kind: z.literal('month'),
    /** 0 = this month, -1 = last month, ... */
    offset: z.number().int().min(-120).max(0),
  }),
  z.strictObject({
    kind: z.literal('month'),
    year: z.number().int().min(2000).max(2100),
    month: z.number().int().min(1).max(12),
  }),
  z.strictObject({
    kind: z.literal('last_days'),
    days: z.number().int().min(1).max(365),
  }),
]);
export type PeriodInput = z.infer<typeof periodSchema>;

export interface ResolvedPeriod {
  /** Human label, e.g. "October 2026" or "last 30 days". */
  label: string;
  /** Local start date, YYYY-MM-DD. */
  from: string;
  /** Local end date, exclusive, YYYY-MM-DD. */
  to: string;
  /** Instants, ISO UTC, half-open [start, end). */
  start: string;
  end: string;
  /** Set for calendar months. */
  month?: BudgetPeriod;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
export { MONTH_NAMES };

const pad = (n: number) => String(n).padStart(2, '0');
const dateKey = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;

function localDate(instant: string, timeZone: string): string {
  const l = toLocal(instant, timeZone);
  return dateKey(l.year, l.month, l.day);
}

/** Resolves a period against `now` in the user's time zone. */
export function resolvePeriod(period: PeriodInput, now: Date, timeZone: string): ResolvedPeriod {
  if (period.kind === 'last_days') {
    const today = toLocal(now, timeZone);
    const first = new Date(Date.UTC(today.year, today.month - 1, today.day - (period.days - 1)));
    const next = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
    const start = fromLocal(
      {
        year: first.getUTCFullYear(),
        month: first.getUTCMonth() + 1,
        day: first.getUTCDate(),
        hour: 0,
        minute: 0,
      },
      timeZone,
    ).toISOString();
    const end = fromLocal(
      {
        year: next.getUTCFullYear(),
        month: next.getUTCMonth() + 1,
        day: next.getUTCDate(),
        hour: 0,
        minute: 0,
      },
      timeZone,
    ).toISOString();
    return {
      label: period.days === 1 ? 'today' : `last ${period.days} days`,
      from: dateKey(first.getUTCFullYear(), first.getUTCMonth() + 1, first.getUTCDate()),
      to: dateKey(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()),
      start,
      end,
    };
  }
  let year: number;
  let month: number;
  if ('offset' in period) {
    const today = toLocal(now, timeZone);
    const index = today.year * 12 + (today.month - 1) + period.offset;
    year = Math.floor(index / 12);
    month = (index % 12) + 1;
  } else {
    year = period.year;
    month = period.month;
  }
  // Noon on the 15th is unambiguous in every zone, so monthPeriod finds the right month.
  const mid = fromLocal({ year, month, day: 15, hour: 12, minute: 0 }, timeZone);
  const bounds = monthPeriod(mid, timeZone);
  return {
    label: `${MONTH_NAMES[month - 1]} ${year}`,
    from: dateKey(year, month, 1),
    to: localDate(bounds.end, timeZone),
    start: bounds.start,
    end: bounds.end,
    month: bounds,
  };
}

// ---------------------------------------------------------------------------
// Analysis shared by the tools and the rules-based answerer
// ---------------------------------------------------------------------------

export interface MerchantSpend {
  /** Display name, or the people bucket in cloud mode. */
  name: string;
  amountMinor: number;
  count: number;
  isPeople: boolean;
}

export interface PeriodAnalysis {
  period: ResolvedPeriod;
  currency: string;
  totalMinor: number;
  /** Counted expenses (duplicates and transfers excluded). */
  count: number;
  byCategory: Map<CategoryId, number>;
  /** All merchants, largest first. */
  merchants: MerchantSpend[];
}

export function categoryName(id: CategoryId): string {
  const known = CATEGORIES.find((c) => c.id === id);
  if (known) return known.name;
  const slug = id.startsWith('custom.') ? id.slice('custom.'.length) : id;
  const words = slug.replace(/_/g, ' ').trim();
  return clip(words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Custom');
}

function clip(text: string): string {
  return text.length > MAX_NAME_CHARS ? `${text.slice(0, MAX_NAME_CHARS - 1)}…` : text;
}

function merchantLabel(
  tx: Transaction,
  privacy: AskPrivacy,
): { key: string; name: string; people: boolean } {
  if (privacy === 'cloud' && isPaymentToPerson({ ...tx, kind: 'expense' })) {
    return { key: '\u0000people', name: PEOPLE_BUCKET_NAME, people: true };
  }
  const name = tx.merchantName?.trim() || 'Unknown merchant';
  const key = tx.merchantName ? toMerchantKey(tx.merchantName) || name.toLowerCase() : 'unknown';
  if (privacy === 'cloud' && !lookupMerchant(key)) {
    return { key: '\u0000other', name: OTHER_MERCHANTS_BUCKET_NAME, people: false };
  }
  return { key, name: clip(name), people: false };
}

export async function analyzePeriod(
  ctx: ToolContext,
  period: ResolvedPeriod,
): Promise<PeriodAnalysis> {
  const currency = ctx.currency ?? DEFAULT_ASK_CURRENCY;
  const rows = await ctx.repos.transactions.listBetween(period.start, period.end);
  const totals = spendingTotals(rows, { period, currency });

  const byId = new Map(rows.map((t) => [t.id, t]));
  const net = new Map<string, MerchantSpend>();
  let count = 0;
  const add = (tx: Transaction, delta: number, counted: boolean) => {
    const label = merchantLabel(tx, ctx.privacy);
    const entry = net.get(label.key) ?? {
      name: label.name,
      amountMinor: 0,
      count: 0,
      isPeople: label.people,
    };
    entry.amountMinor += delta;
    if (counted) entry.count += 1;
    net.set(label.key, entry);
  };
  for (const t of rows) {
    if (t.deletedAt !== null || t.currency !== currency) continue;
    if (t.kind === 'expense' && t.linkedTransactionId === null) {
      add(t, t.amountMinor, true);
      count += 1;
    } else if (t.kind === 'refund' && t.linkedTransactionId !== null) {
      add(byId.get(t.linkedTransactionId) ?? t, -t.amountMinor, false);
    }
  }
  const merchants = [...net.values()]
    .map((m) => ({ ...m, amountMinor: Math.max(0, m.amountMinor) }))
    .filter((m) => m.amountMinor > 0 || m.count > 0)
    .sort((a, b) => b.amountMinor - a.amountMinor || a.name.localeCompare(b.name));

  return {
    period,
    currency,
    totalMinor: totals.totalMinor,
    count,
    byCategory: new Map(totals.byCategory),
    merchants,
  };
}

// ---------------------------------------------------------------------------
// Tool inputs and outputs
// ---------------------------------------------------------------------------

const periodOnly = z.strictObject({ period: periodSchema });
const topMerchantsInput = z.strictObject({
  period: periodSchema,
  limit: z.number().int().min(1).max(10).default(5),
});
const comparePeriodsInput = z.strictObject({ periodA: periodSchema, periodB: periodSchema });
const noInput = z.strictObject({});

export interface PeriodSummary {
  label: string;
  from: string;
  to: string;
}

const summary = (p: ResolvedPeriod): PeriodSummary => ({ label: p.label, from: p.from, to: p.to });

export interface SpendingTotalOutput {
  period: PeriodSummary;
  currency: string;
  totalMinor: number;
  transactionCount: number;
}
export interface SpendingByCategoryOutput {
  period: PeriodSummary;
  currency: string;
  totalMinor: number;
  categories: { categoryId: string; name: string; amountMinor: number }[];
  truncated?: boolean;
}
export interface TopMerchantsOutput {
  period: PeriodSummary;
  currency: string;
  merchants: { name: string; amountMinor: number; transactionCount: number }[];
  truncated?: boolean;
}
export interface ComparePeriodsOutput {
  currency: string;
  periodA: PeriodSummary & { totalMinor: number };
  periodB: PeriodSummary & { totalMinor: number };
  /** periodA minus periodB. */
  differenceMinor: number;
  /** Rounded to 1 decimal; null when periodB is zero. */
  percentChange: number | null;
  /** Largest category differences first. */
  categories: {
    categoryId: string;
    name: string;
    aMinor: number;
    bMinor: number;
    deltaMinor: number;
  }[];
  truncated?: boolean;
}
export interface BudgetStatusOutput {
  period: PeriodSummary;
  budgets: {
    categoryId: string | null;
    name: string;
    currency: string;
    budgetMinor: number;
    spentMinor: number;
    remainingMinor: number;
    percentUsed: number;
    percentOfMonthElapsed: number;
    status: PaceStatus;
  }[];
}
export interface UpcomingSubscriptionsOutput {
  windowDays: number;
  subscriptions: {
    merchant: string;
    amountMinor: number;
    currency: string;
    cadence: string;
    /** Local date, YYYY-MM-DD. */
    dueDate: string;
  }[];
  totalMinor: number;
  currency: string;
  truncated?: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const PERIOD_SCHEMA_JSON = {
  description:
    'A calendar month ({"kind":"month","offset":0} is this month, -1 last month, or {"kind":"month","year":2026,"month":9}) or the last N days ({"kind":"last_days","days":30}, at most 365).',
  oneOf: [
    {
      type: 'object',
      properties: { kind: { const: 'month' }, offset: { type: 'integer', maximum: 0 } },
      required: ['kind', 'offset'],
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'month' },
        year: { type: 'integer' },
        month: { type: 'integer', minimum: 1, maximum: 12 },
      },
      required: ['kind', 'year', 'month'],
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'last_days' },
        days: { type: 'integer', minimum: 1, maximum: 365 },
      },
      required: ['kind', 'days'],
    },
  ],
} as const;

export const ASK_TOOLS: readonly AskToolDefinition[] = [
  {
    name: 'spending_total',
    description:
      'Total spending for a period in minor units (cents). Excludes transfers and income; refunds are subtracted.',
    input_schema: {
      type: 'object',
      properties: { period: PERIOD_SCHEMA_JSON },
      required: ['period'],
    },
  },
  {
    name: 'spending_by_category',
    description: 'Spending per category for a period, largest first, in minor units (cents).',
    input_schema: {
      type: 'object',
      properties: { period: PERIOD_SCHEMA_JSON },
      required: ['period'],
    },
  },
  {
    name: 'top_merchants',
    description:
      'Merchants with the most spending in a period, largest first. Payments to people are one combined bucket.',
    input_schema: {
      type: 'object',
      properties: {
        period: PERIOD_SCHEMA_JSON,
        limit: { type: 'integer', minimum: 1, maximum: 10 },
      },
      required: ['period'],
    },
  },
  {
    name: 'compare_periods',
    description:
      'Compare total and per-category spending between two periods (difference is periodA minus periodB).',
    input_schema: {
      type: 'object',
      properties: { periodA: PERIOD_SCHEMA_JSON, periodB: PERIOD_SCHEMA_JSON },
      required: ['periodA', 'periodB'],
    },
  },
  {
    name: 'budget_status',
    description:
      "Each active monthly budget with this month's spending, percent used and pace status.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'upcoming_subscriptions',
    description: 'Subscription charges expected in the next 30 days.',
    input_schema: { type: 'object', properties: {} },
  },
];

export const ASK_TOOL_NAMES: readonly string[] = ASK_TOOLS.map((t) => t.name);

// ---------------------------------------------------------------------------
// Executors
// ---------------------------------------------------------------------------

export type ToolOutcome =
  { ok: true; output: unknown } | { ok: false; error: 'unknown_tool' | 'invalid_input' | 'failed' };

/** UTF-8 size of the JSON serialization (the proxy caps toolResults by this). */
export function jsonBytes(value: unknown): number {
  const json = JSON.stringify(value);
  let bytes = 0;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}
const byteLength = jsonBytes;

/** Drops list items (longest list first) until the output fits; marks it truncated. */
export function fitOutput<T extends object>(output: T, maxBytes = MAX_TOOL_OUTPUT_BYTES): T {
  const copy = { ...output } as Record<string, unknown>;
  let truncated = false;
  while (byteLength(copy) > maxBytes) {
    let longest: unknown[] | null = null;
    for (const value of Object.values(copy)) {
      if (Array.isArray(value) && value.length > 0 && (!longest || value.length > longest.length)) {
        longest = value;
      }
    }
    if (!longest) break;
    if (!truncated) {
      truncated = true;
      copy['truncated'] = true;
    }
    longest.pop();
  }
  return copy as unknown as T;
}

export async function executeTool(
  name: string,
  input: unknown,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  if (!ASK_TOOL_NAMES.includes(name)) return { ok: false, error: 'unknown_tool' };
  try {
    switch (name) {
      case 'spending_total': {
        const parsed = periodOnly.safeParse(input);
        if (!parsed.success) return { ok: false, error: 'invalid_input' };
        return { ok: true, output: await spendingTotal(parsed.data.period, ctx) };
      }
      case 'spending_by_category': {
        const parsed = periodOnly.safeParse(input);
        if (!parsed.success) return { ok: false, error: 'invalid_input' };
        return { ok: true, output: fitOutput(await spendingByCategory(parsed.data.period, ctx)) };
      }
      case 'top_merchants': {
        const parsed = topMerchantsInput.safeParse(input);
        if (!parsed.success) return { ok: false, error: 'invalid_input' };
        return {
          ok: true,
          output: fitOutput(await topMerchants(parsed.data.period, parsed.data.limit, ctx)),
        };
      }
      case 'compare_periods': {
        const parsed = comparePeriodsInput.safeParse(input);
        if (!parsed.success) return { ok: false, error: 'invalid_input' };
        return {
          ok: true,
          output: fitOutput(await comparePeriods(parsed.data.periodA, parsed.data.periodB, ctx)),
        };
      }
      case 'budget_status': {
        if (!noInput.safeParse(input ?? {}).success) return { ok: false, error: 'invalid_input' };
        return { ok: true, output: fitOutput(await budgetStatus(ctx)) };
      }
      case 'upcoming_subscriptions': {
        if (!noInput.safeParse(input ?? {}).success) return { ok: false, error: 'invalid_input' };
        return { ok: true, output: fitOutput(await upcomingSubscriptions(ctx)) };
      }
      default:
        return { ok: false, error: 'unknown_tool' };
    }
  } catch {
    // Never surface the underlying error: it could carry row data.
    return { ok: false, error: 'failed' };
  }
}

export async function spendingTotal(
  period: PeriodInput,
  ctx: ToolContext,
): Promise<SpendingTotalOutput> {
  const a = await analyzePeriod(ctx, resolvePeriod(period, ctx.now, ctx.timeZone));
  return {
    period: summary(a.period),
    currency: a.currency,
    totalMinor: a.totalMinor,
    transactionCount: a.count,
  };
}

export async function spendingByCategory(
  period: PeriodInput,
  ctx: ToolContext,
): Promise<SpendingByCategoryOutput> {
  const a = await analyzePeriod(ctx, resolvePeriod(period, ctx.now, ctx.timeZone));
  const all = [...a.byCategory.entries()]
    .filter(([, amount]) => amount > 0)
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  const categories = all.slice(0, MAX_CATEGORIES).map(([id, amountMinor]) => ({
    categoryId: id as string,
    name: categoryName(id),
    amountMinor,
  }));
  return {
    period: summary(a.period),
    currency: a.currency,
    totalMinor: a.totalMinor,
    categories,
    ...(all.length > categories.length ? { truncated: true } : {}),
  };
}

export async function topMerchants(
  period: PeriodInput,
  limit: number,
  ctx: ToolContext,
): Promise<TopMerchantsOutput> {
  const a = await analyzePeriod(ctx, resolvePeriod(period, ctx.now, ctx.timeZone));
  const capped = Math.min(10, Math.max(1, limit));
  return {
    period: summary(a.period),
    currency: a.currency,
    merchants: a.merchants
      .slice(0, capped)
      .map((m) => ({ name: m.name, amountMinor: m.amountMinor, transactionCount: m.count })),
    ...(a.merchants.length > capped ? { truncated: true } : {}),
  };
}

export async function comparePeriods(
  periodA: PeriodInput,
  periodB: PeriodInput,
  ctx: ToolContext,
): Promise<ComparePeriodsOutput> {
  const [a, b] = await Promise.all([
    analyzePeriod(ctx, resolvePeriod(periodA, ctx.now, ctx.timeZone)),
    analyzePeriod(ctx, resolvePeriod(periodB, ctx.now, ctx.timeZone)),
  ]);
  const ids = new Set<CategoryId>([...a.byCategory.keys(), ...b.byCategory.keys()]);
  const rows = [...ids]
    .map((id) => {
      const aMinor = a.byCategory.get(id) ?? 0;
      const bMinor = b.byCategory.get(id) ?? 0;
      return {
        categoryId: id as string,
        name: categoryName(id),
        aMinor,
        bMinor,
        deltaMinor: aMinor - bMinor,
      };
    })
    .filter((r) => r.deltaMinor !== 0)
    .sort(
      (x, y) =>
        Math.abs(y.deltaMinor) - Math.abs(x.deltaMinor) || x.categoryId.localeCompare(y.categoryId),
    );
  const categories = rows.slice(0, MAX_COMPARE_CATEGORIES);
  return {
    currency: a.currency,
    periodA: { ...summary(a.period), totalMinor: a.totalMinor },
    periodB: { ...summary(b.period), totalMinor: b.totalMinor },
    differenceMinor: a.totalMinor - b.totalMinor,
    percentChange:
      b.totalMinor > 0 ? round1(((a.totalMinor - b.totalMinor) / b.totalMinor) * 100) : null,
    categories,
    ...(rows.length > categories.length ? { truncated: true } : {}),
  };
}

export async function budgetStatus(ctx: ToolContext): Promise<BudgetStatusOutput> {
  const period = resolvePeriod({ kind: 'month', offset: 0 }, ctx.now, ctx.timeZone);
  const budgets = await ctx.repos.budgets.listActive();
  const rows = await ctx.repos.transactions.listBetween(period.start, period.end);
  const byCurrency = new Map<string, ReturnType<typeof spendingTotals>>();
  const out: BudgetStatusOutput['budgets'] = [];
  for (const budget of budgets) {
    let totals = byCurrency.get(budget.currency);
    if (!totals) {
      totals = spendingTotals(rows, { period, currency: budget.currency });
      byCurrency.set(budget.currency, totals);
    }
    const spent = spentForBudget(budget, totals);
    const pace = paceFor({ amountMinor: budget.amountMinor }, spent, ctx.now, {
      timeZone: ctx.timeZone,
      period,
    });
    out.push({
      categoryId: budget.categoryId,
      name: budget.categoryId === null ? 'Overall' : categoryName(budget.categoryId),
      currency: budget.currency,
      budgetMinor: budget.amountMinor,
      spentMinor: spent,
      remainingMinor: Math.max(0, budget.amountMinor - spent),
      percentUsed: round1(pace.percentUsed),
      percentOfMonthElapsed: round1(pace.percentOfPeriodElapsed),
      status: pace.status,
    });
  }
  out.sort((x, y) => (x.categoryId === null ? -1 : y.categoryId === null ? 1 : 0));
  return { period: summary(period), budgets: out };
}

export async function upcomingSubscriptions(
  ctx: ToolContext,
): Promise<UpcomingSubscriptionsOutput> {
  const currency = ctx.currency ?? DEFAULT_ASK_CURRENCY;
  const subs = await ctx.repos.subscriptions.listActive();
  const byId = new Map(subs.map((s) => [s.id, s]));
  const to = new Date(ctx.now.getTime() + UPCOMING_DAYS * 86_400_000);
  const charges = upcomingCharges(subs, ctx.now, to, currency);
  const items = charges.slice(0, MAX_SUBSCRIPTIONS).map((c) => {
    const sub = byId.get(c.subscriptionId)!;
    return {
      merchant: clip(sub.merchantName),
      amountMinor: c.amountMinor,
      currency: sub.currency,
      cadence: sub.cadence,
      dueDate: localDate(c.dueAt, ctx.timeZone),
    };
  });
  return {
    windowDays: UPCOMING_DAYS,
    subscriptions: items,
    totalMinor: charges.reduce((sum, c) => sum + c.amountMinor, 0),
    currency,
    ...(charges.length > items.length ? { truncated: true } : {}),
  };
}
