/**
 * Spending trends for the Trends screen. Shared by the repo-backed and synthetic data sources so
 * both add up the same way.
 *
 * Category and month totals are `spendingTotals` from agent-core (the budget math): refunds
 * offset spending, income and transfers are left out, an expense linked to another row is a
 * duplicate and counts once, each category is floored at 0. Merchants follow the same rules, as
 * the Ask tools do on this phone (`analyzePeriod` in local mode).
 */
import { spendingTotals } from '@steadily/agent-core';
import { toMerchantKey } from '@steadily/merchants';

import { monthRange } from '@/lib/dates';

import type { DateRange, MerchantSpend, Trends, Transaction } from './types';

/** Months in the bar chart, ending with the selected one. */
export const TREND_MONTHS = 6;
export const TOP_MERCHANT_COUNT = 5;
/** Trends are in US dollars (US launch). Other currencies are left out, as in Ask. */
export const TRENDS_CURRENCY = 'USD';

/** First day of the local month `offset` months from the one containing `date`. */
export function addMonths(date: Date, offset: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

/**
 * Transactions `computeTrends` needs for `month`: the chart months plus one more before them, so
 * a refund early in the window can be matched to the purchase it pays back.
 */
export function trendsWindow(month: Date): DateRange {
  return {
    from: addMonths(month, -TREND_MONTHS).toISOString(),
    to: addMonths(month, 1).toISOString(),
  };
}

function merchantSpend(
  rows: readonly Transaction[],
  period: DateRange,
  byId: ReadonlyMap<string, Transaction>,
): MerchantSpend[] {
  const net = new Map<string, MerchantSpend>();
  const add = (tx: Transaction, delta: number, counted: boolean) => {
    const name = tx.merchantName?.trim() || 'Unknown merchant';
    const key = tx.merchantName ? toMerchantKey(tx.merchantName) || name.toLowerCase() : '';
    const entry = net.get(key) ?? { name, amountMinor: 0, count: 0 };
    entry.amountMinor += delta;
    if (counted) entry.count += 1;
    net.set(key, entry);
  };
  const from = Date.parse(period.from);
  const to = Date.parse(period.to);
  for (const t of rows) {
    if (t.deletedAt !== null || t.currency !== TRENDS_CURRENCY) continue;
    const at = Date.parse(t.occurredAt);
    if (at < from || at >= to) continue;
    if (t.kind === 'expense' && t.linkedTransactionId === null) {
      add(t, t.amountMinor, true);
    } else if (t.kind === 'refund' && t.linkedTransactionId !== null) {
      add(byId.get(t.linkedTransactionId) ?? t, -t.amountMinor, false);
    }
  }
  return [...net.values()]
    .map((m) => ({ ...m, amountMinor: Math.max(0, m.amountMinor) }))
    .filter((m) => m.amountMinor > 0)
    .sort((a, b) => b.amountMinor - a.amountMinor || a.name.localeCompare(b.name));
}

/**
 * Trends for the local month containing `month`, from `rows` (any order; pass at least
 * `trendsWindow(month)`).
 */
export function computeTrends(rows: readonly Transaction[], month: Date): Trends {
  const totalFor = (range: DateRange) =>
    spendingTotals(rows, {
      period: { start: range.from, end: range.to },
      currency: TRENDS_CURRENCY,
    });

  const selected = monthRange(month);
  const totals = totalFor(selected);
  const months = Array.from({ length: TREND_MONTHS }, (_, i) => {
    const range = monthRange(addMonths(month, i - (TREND_MONTHS - 1)));
    return { month: range, totalMinor: totalFor(range).totalMinor };
  });
  const byId = new Map(rows.map((t) => [t.id, t]));

  return {
    month: selected,
    totalMinor: totals.totalMinor,
    previousTotalMinor: months[TREND_MONTHS - 2]?.totalMinor ?? 0,
    byCategory: [...totals.byCategory]
      .filter(([, amountMinor]) => amountMinor > 0)
      .map(([categoryId, amountMinor]) => ({ categoryId, amountMinor }))
      .sort((a, b) => b.amountMinor - a.amountMinor || a.categoryId.localeCompare(b.categoryId)),
    topMerchants: merchantSpend(rows, selected, byId).slice(0, TOP_MERCHANT_COUNT),
    months,
  };
}
