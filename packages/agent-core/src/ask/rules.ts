/**
 * Rules-based answerer for "Ask your money": works with no LLM at all, and is
 * the fallback when a model fails. It runs the same on-device tools, in local
 * privacy mode (answers never leave the device).
 */
import { toMerchantKey } from '@steadily/merchants';
import { CATEGORIES, type CategoryId } from '@steadily/taxonomy';
import { toLocal } from '../budget-math';
import {
  analyzePeriod,
  budgetStatus,
  categoryName,
  comparePeriods,
  MONTH_NAMES,
  resolvePeriod,
  topMerchants,
  upcomingSubscriptions,
  type PeriodAnalysis,
  type PeriodInput,
  type ToolContext,
} from './tools';

export function formatMoney(amountMinor: number, currency = 'USD'): string {
  const negative = amountMinor < 0;
  const abs = Math.abs(Math.trunc(amountMinor));
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = String(abs % 100).padStart(2, '0');
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  return `${negative ? '-' : ''}${symbol}${whole}.${cents}`;
}

export const HELP_TEXT = [
  'I can answer questions about your spending right here on your device. Try:',
  '- How much did I spend this month?',
  '- How much did I spend on groceries last month?',
  '- What are my top merchants?',
  '- Compare this month to last month',
  '- Am I on budget?',
  '- What subscriptions are coming up?',
].join('\n');

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const CATEGORY_SYNONYMS: Record<string, readonly string[]> = {
  'food.groceries': ['groceries', 'grocery', 'supermarket', 'supermarkets', 'food shopping'],
  'food.dining': [
    'dining out',
    'dining',
    'eating out',
    'restaurants',
    'restaurant',
    'takeout',
    'take out',
    'fast food',
    'food delivery',
  ],
  'food.coffee': ['coffee', 'coffee shops', 'cafe', 'cafes'],
  'transport.general': [
    'transport',
    'transportation',
    'transit',
    'rideshare',
    'parking',
    'commute',
  ],
  'transport.gas': ['gas', 'gasoline', 'fuel'],
  'shopping.general': ['shopping', 'clothes', 'clothing'],
  'bills.utilities': ['bills and utilities', 'bills', 'utilities', 'utility'],
  'housing.rent_mortgage': ['rent', 'mortgage', 'housing'],
  'subscriptions.general': ['subscriptions', 'subscription'],
  'health.general': ['health', 'healthcare', 'medical', 'doctor', 'pharmacy'],
  'entertainment.general': ['entertainment', 'movies', 'games'],
  'travel.general': ['travel', 'trips', 'flights', 'hotels', 'vacation'],
  'personal_care.general': ['personal care', 'beauty', 'haircut', 'salon', 'grooming'],
  'gifts.general': ['gifts', 'gift', 'giving', 'donations', 'charity'],
  'other.general': ['other'],
};

const MONTH_PATTERNS: [RegExp, number][] = MONTH_NAMES.map((name, i) => {
  const lower = name.toLowerCase();
  const short = lower.slice(0, 3);
  const alt =
    lower === 'may' ? 'may' : lower === 'september' ? 'september|sept|sep' : `${lower}|${short}`;
  return [new RegExp(`\\b(?:${alt})\\b`), i + 1];
});

function normalize(question: string): string {
  return question
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9'&$ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface PeriodMatch {
  period: PeriodInput;
  index: number;
  length: number;
}

const PREPOSITION = '(?:(?:in|for|during|of|from|than)\\s+)?';

function findPeriods(q: string, now: Date, timeZone: string): PeriodMatch[] {
  const found: PeriodMatch[] = [];
  const claim = (re: RegExp, make: (m: RegExpExecArray) => PeriodInput | null) => {
    const g = new RegExp(re.source, 'g');
    for (let m = g.exec(q); m; m = g.exec(q)) {
      const period = make(m);
      if (!period) continue;
      const end = m.index + m[0].length;
      if (found.some((f) => m!.index < f.index + f.length && end > f.index)) continue;
      found.push({ period, index: m.index, length: m[0].length });
    }
  };
  claim(/\b(?:in the |for the |over the )?(?:last|past|previous) (\d{1,3}) days\b/, (m) => ({
    kind: 'last_days',
    days: Math.min(365, Math.max(1, Number(m[1]))),
  }));
  claim(/\b(?:in the |for the |over the )?(?:last|past|previous) week\b|\bthis week\b/, () => ({
    kind: 'last_days',
    days: 7,
  }));
  claim(/\btoday\b/, () => ({ kind: 'last_days', days: 1 }));
  claim(new RegExp(`\\b${PREPOSITION}this month\\b`), () => ({ kind: 'month', offset: 0 }));
  claim(new RegExp(`\\b${PREPOSITION}(?:last|previous) month\\b`), () => ({
    kind: 'month',
    offset: -1,
  }));
  const today = toLocal(now, timeZone);
  for (const [re, month] of MONTH_PATTERNS) {
    const withYear = new RegExp(`\\b${PREPOSITION}${re.source}(?:\\s+(20\\d{2}))?\\b`, '');
    const g = new RegExp(withYear.source, 'g');
    for (let m = g.exec(q); m; m = g.exec(q)) {
      // "may" is also a verb: only treat it as a month after a preposition or with a year.
      if (month === 5 && !/^(in|for|during|of|from|than)\b/.test(m[0]) && !m[1]) continue;
      const year = m[1] ? Number(m[1]) : month > today.month ? today.year - 1 : today.year;
      const offset = (year - today.year) * 12 + (month - today.month);
      if (offset > 0 || offset < -120) continue;
      const end = m.index + m[0].length;
      if (found.some((f) => m!.index < f.index + f.length && end > f.index)) continue;
      found.push({ period: { kind: 'month', offset }, index: m.index, length: m[0].length });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

function removeSpans(q: string, matches: readonly PeriodMatch[]): string {
  let out = q;
  for (const m of [...matches].sort((a, b) => b.index - a.index)) {
    out = `${out.slice(0, m.index)} ${out.slice(m.index + m.length)}`;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function phrase(label: string, period: PeriodInput, current = false): string {
  if (period.kind === 'last_days')
    return period.days === 1 ? 'today' : `in the last ${period.days} days`;
  if ('offset' in period) {
    if (period.offset === 0) return current ? 'so far this month' : 'this month';
    if (period.offset === -1) return 'last month';
  }
  return `in ${label}`;
}

const isCurrentMonth = (p: PeriodInput) => p.kind === 'month' && 'offset' in p && p.offset === 0;

function matchCategory(q: string, extra: ReadonlyMap<CategoryId, number>): CategoryId | null {
  let best: { id: CategoryId; length: number } | null = null;
  const consider = (id: CategoryId, term: string) => {
    if (!new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(q)) return;
    if (!best || term.length > best.length) best = { id, length: term.length };
  };
  for (const category of CATEGORIES) {
    consider(category.id, category.name.toLowerCase());
    for (const term of CATEGORY_SYNONYMS[category.id] ?? []) consider(category.id, term);
  }
  for (const id of extra.keys()) {
    if (id.startsWith('custom.')) consider(id, categoryName(id).toLowerCase());
  }
  return (best as { id: CategoryId } | null)?.id ?? null;
}

const GENERIC_TARGETS = new Set([
  '',
  'everything',
  'all',
  'stuff',
  'things',
  'total',
  'money',
  'it',
  'anything',
]);

function extractTarget(rest: string): string {
  const m = /\b(?:on|at|to|with)\s+(.+)$/.exec(rest);
  if (!m) return '';
  return m[1]!
    .replace(/\b(so far|in total|altogether|overall|in all)\b/g, ' ')
    .replace(/^(?:the|my|all|any)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------

type Intent = 'compare' | 'budget' | 'top_merchants' | 'subscriptions' | 'spend' | 'unknown';

function detectIntent(q: string): Intent {
  if (/compar|\bvs\b|versus|(more|less) than (last|previous)/.test(q)) return 'compare';
  if (/\bbudgets?\b|on track|safe to spend|\bpace\b/.test(q)) return 'budget';
  if (
    /\btop (\d+ )?(merchants?|stores|places|expenses)\b|biggest (expenses?|merchants?|spend)|where (did|does|is|has) (all )?(of )?(my|the) money (go|going|gone)|where (am i|have i|did i) (been )?spen(d|ding|t)|spen(d|ding|t) the most|most (money|spending)/.test(
      q,
    )
  ) {
    return 'top_merchants';
  }
  if (
    /subscription|recurring|renew|coming up|upcoming/.test(q) &&
    !/how much|total|spent|spend/.test(q)
  ) {
    return 'subscriptions';
  }
  if (/\bspen(d|t|ding)\b|\bspending\b|how much/.test(q)) return 'spend';
  return 'unknown';
}

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export async function answerWithRules(question: string, base: ToolContext): Promise<string> {
  const ctx: ToolContext = { ...base, privacy: 'local' };
  const currency = ctx.currency ?? 'USD';
  const q = normalize(question);
  const intent = detectIntent(q);
  const periods = findPeriods(q, ctx.now, ctx.timeZone);
  const first: PeriodInput = periods[0]?.period ?? { kind: 'month', offset: 0 };
  const label = (p: PeriodInput) => resolvePeriod(p, ctx.now, ctx.timeZone).label;

  switch (intent) {
    case 'compare': {
      const a: PeriodInput = periods[0]?.period ?? { kind: 'month', offset: 0 };
      const b: PeriodInput =
        periods[1]?.period ??
        (isCurrentMonth(a) ? { kind: 'month', offset: -1 } : { kind: 'month', offset: 0 });
      const out = await comparePeriods(a, b, ctx);
      const pa = phrase(out.periodA.label, a);
      const pb = phrase(out.periodB.label, b);
      const amtA = formatMoney(out.periodA.totalMinor, currency);
      const amtB = formatMoney(out.periodB.totalMinor, currency);
      if (out.differenceMinor === 0) {
        return `You spent the same amount, ${amtA}, ${pa} and ${pb}.`;
      }
      const more = out.differenceMinor > 0;
      const pct =
        out.percentChange === null
          ? ''
          : ` (${Math.abs(out.percentChange)}% ${more ? 'higher' : 'lower'})`;
      let text = `You spent ${amtA} ${pa} versus ${amtB} ${pb}: ${formatMoney(Math.abs(out.differenceMinor), currency)} ${more ? 'more' : 'less'}${pct}.`;
      const top = out.categories[0];
      if (top) {
        text += `\nBiggest change: ${top.name}, ${formatMoney(Math.abs(top.deltaMinor), currency)} ${top.deltaMinor > 0 ? 'more' : 'less'}.`;
      }
      return text;
    }

    case 'budget': {
      const out = await budgetStatus(ctx);
      if (out.budgets.length === 0) {
        return "You haven't set any budgets yet. Add one in Budgets and I can tell you how you're pacing.";
      }
      const over = out.budgets.filter((b) => b.status === 'over').length;
      const ahead = out.budgets.filter((b) => b.status === 'a_little_ahead').length;
      const headline =
        over > 0
          ? `You're over budget on ${over} of ${out.budgets.length} budgets this month.`
          : ahead > 0
            ? `You're a little ahead of pace on ${ahead} of ${out.budgets.length} budgets this month.`
            : "You're on track with all your budgets this month.";
      const status = {
        on_track: 'on track',
        a_little_ahead: 'a little ahead of pace',
        over: 'over budget',
      };
      const lines = out.budgets.map(
        (b) =>
          `- ${b.name}: ${formatMoney(b.spentMinor, b.currency)} of ${formatMoney(b.budgetMinor, b.currency)} (${Math.round(b.percentUsed)}%), ${status[b.status]}`,
      );
      return [headline, ...lines].join('\n');
    }

    case 'top_merchants': {
      const n = /\btop (\d{1,2})\b/.exec(q);
      const limit = n ? Math.min(10, Math.max(1, Number(n[1]))) : 5;
      const out = await topMerchants(first, limit, ctx);
      const when = phrase(out.period.label, first);
      if (out.merchants.length === 0) return `I don't see any spending ${when} yet.`;
      const lines = out.merchants.map(
        (m, i) => `${i + 1}. ${m.name}: ${formatMoney(m.amountMinor, currency)}`,
      );
      return [`Your top merchants ${when}:`, ...lines].join('\n');
    }

    case 'subscriptions': {
      const out = await upcomingSubscriptions(ctx);
      if (out.subscriptions.length === 0) {
        return "I don't see any subscription charges coming up in the next 30 days.";
      }
      const lines = out.subscriptions.map((s) => {
        const [, month, day] = s.dueDate.split('-').map(Number);
        return `- ${s.merchant}: ${formatMoney(s.amountMinor, s.currency)} on ${MONTH_ABBR[(month ?? 1) - 1]} ${day} (${s.cadence})`;
      });
      return [
        `Coming up in the next ${out.windowDays} days:`,
        ...lines,
        `Total: ${formatMoney(out.totalMinor, out.currency)}`,
      ].join('\n');
    }

    case 'spend': {
      const analysis = await analyzePeriod(ctx, resolvePeriod(first, ctx.now, ctx.timeZone));
      const rest = removeSpans(q, periods);
      const categoryId = matchCategory(rest, analysis.byCategory);
      const current = isCurrentMonth(first);
      const when = phrase(analysis.period.label, first, true);
      const whenPlain = phrase(analysis.period.label, first);
      const say = (amount: number, subject: string) =>
        amount <= 0
          ? `You haven't spent anything${subject} ${when}.`
          : current
            ? `So far this month you've spent ${formatMoney(amount, currency)}${subject}.`
            : `You spent ${formatMoney(amount, currency)}${subject} ${whenPlain}.`;

      if (categoryId) {
        return say(analysis.byCategory.get(categoryId) ?? 0, ` on ${categoryName(categoryId)}`);
      }
      const target = extractTarget(rest);
      if (GENERIC_TARGETS.has(target)) return say(analysis.totalMinor, '');
      const found = findMerchant(analysis, target);
      if (found) return say(found.amountMinor, ` at ${found.name}`);
      return `I couldn't match "${target}" to a category or a merchant. Try a category like groceries or dining, or a merchant you've paid.`;
    }

    default:
      return HELP_TEXT;
  }
}

function findMerchant(analysis: PeriodAnalysis, target: string) {
  const key = toMerchantKey(target);
  if (!key) return null;
  const matches = analysis.merchants.filter((m) => {
    const mk = toMerchantKey(m.name);
    return (
      mk === key || mk.includes(key) || (key.length >= 4 && key.includes(mk) && mk.length >= 4)
    );
  });
  if (matches.length === 0) return null;
  return {
    name: matches[0]!.name,
    amountMinor: matches.reduce((sum, m) => sum + m.amountMinor, 0),
  };
}
