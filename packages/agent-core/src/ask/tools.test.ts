import { describe, expect, it } from 'vitest';
import { createInMemoryRepos } from '../ports';
import {
  ASK_TOOLS,
  executeTool,
  fitOutput,
  jsonBytes,
  MAX_TOOL_OUTPUT_BYTES,
  OTHER_MERCHANTS_BUCKET_NAME,
  PEOPLE_BUCKET_NAME,
  resolvePeriod,
  type ToolContext,
} from './tools';
import {
  budget,
  context,
  NOW,
  NY,
  PERSON_NAME,
  SECRET_NOTE,
  seedRepos,
  subscription,
  tx,
} from './fixtures';

async function run(name: string, input: unknown, ctx: ToolContext) {
  const outcome = await executeTool(name, input, ctx);
  if (!outcome.ok) throw new Error(`tool failed: ${outcome.error}`);
  return outcome.output as Record<string, any>;
}

describe('tool definitions', () => {
  it('match the proxy tool shape and stay small', () => {
    expect(ASK_TOOLS.map((t) => t.name)).toEqual([
      'spending_total',
      'spending_by_category',
      'top_merchants',
      'compare_periods',
      'budget_status',
      'upcoming_subscriptions',
    ]);
    for (const tool of ASK_TOOLS) {
      expect(tool.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(tool.description.length).toBeLessThanOrEqual(1024);
      expect(tool.input_schema['type']).toBe('object');
    }
    expect(jsonBytes(ASK_TOOLS)).toBeLessThan(12 * 1024);
  });
});

describe('periods', () => {
  it('resolves month offsets and explicit months in the user time zone', () => {
    const now = resolvePeriod({ kind: 'month', offset: 0 }, NOW, NY);
    expect(now.label).toBe('October 2026');
    expect(now.start).toBe('2026-10-01T04:00:00.000Z');
    expect(now.end).toBe('2026-11-01T04:00:00.000Z');
    expect(now.from).toBe('2026-10-01');
    expect(now.to).toBe('2026-11-01');
    expect(resolvePeriod({ kind: 'month', offset: -1 }, NOW, NY).label).toBe('September 2026');
    expect(resolvePeriod({ kind: 'month', offset: -10 }, NOW, NY).label).toBe('December 2025');
    expect(resolvePeriod({ kind: 'month', year: 2026, month: 3 }, NOW, NY).start).toBe(
      '2026-03-01T05:00:00.000Z',
    );
  });

  it('handles DST boundaries (spring forward, fall back)', () => {
    // March 2026: starts EST (+5), ends EDT (+4) so the month is 743 hours.
    const march = resolvePeriod({ kind: 'month', year: 2026, month: 3 }, NOW, NY);
    expect(march.start).toBe('2026-03-01T05:00:00.000Z');
    expect(march.end).toBe('2026-04-01T04:00:00.000Z');
    // November 2026: starts EDT, ends EST, 721 hours.
    const november = resolvePeriod({ kind: 'month', year: 2026, month: 11 }, NOW, NY);
    expect(november.start).toBe('2026-11-01T04:00:00.000Z');
    expect(november.end).toBe('2026-12-01T05:00:00.000Z');
  });

  it('wraps across years', () => {
    const jan = new Date('2026-01-10T12:00:00.000Z');
    expect(resolvePeriod({ kind: 'month', offset: -1 }, jan, NY).label).toBe('December 2025');
  });

  it('last_days includes today and starts at local midnight', () => {
    const p = resolvePeriod({ kind: 'last_days', days: 30 }, NOW, NY);
    expect(p.from).toBe('2026-09-16');
    expect(p.to).toBe('2026-10-16');
    expect(p.start).toBe('2026-09-16T04:00:00.000Z');
    expect(p.end).toBe('2026-10-16T04:00:00.000Z');
    expect(resolvePeriod({ kind: 'last_days', days: 1 }, NOW, NY).from).toBe('2026-10-15');
  });

  it('puts a transaction just before local midnight in the right month', async () => {
    const repos = createInMemoryRepos();
    // 23:59 EDT on Sept 30 is already October in UTC.
    for (const row of [
      tx({ amountMinor: 111, occurredAt: '2026-10-01T03:59:59.000Z' }),
      tx({ amountMinor: 222, occurredAt: '2026-10-01T04:00:00.000Z' }),
    ]) {
      repos.transactions.rows.set(row.id, row);
    }
    const ctx = context(repos as never);
    expect(
      (await run('spending_total', { period: { kind: 'month', offset: 0 } }, ctx)).totalMinor,
    ).toBe(222);
    expect(
      (await run('spending_total', { period: { kind: 'month', offset: -1 } }, ctx)).totalMinor,
    ).toBe(111);
    // November/December boundary after the fall-back.
    const dec = new Date('2026-12-05T12:00:00.000Z');
    const r2 = createInMemoryRepos();
    for (const row of [
      tx({ amountMinor: 5, occurredAt: '2026-12-01T04:30:00.000Z' }), // Nov 30 23:30 EST
      tx({ amountMinor: 7, occurredAt: '2026-12-01T05:00:00.000Z' }), // Dec 1 00:00 EST
    ]) {
      r2.transactions.rows.set(row.id, row);
    }
    const c2 = context(r2 as never, { now: dec });
    expect(
      (await run('spending_total', { period: { kind: 'month', offset: -1 } }, c2)).totalMinor,
    ).toBe(5);
    expect(
      (await run('spending_total', { period: { kind: 'month', offset: 0 } }, c2)).totalMinor,
    ).toBe(7);
  });
});

describe('input validation', () => {
  const ctx = () => context(seedRepos());

  it('rejects bad inputs without throwing', async () => {
    const bad: [string, unknown][] = [
      ['spending_total', {}],
      ['spending_total', { period: { kind: 'last_days', days: 366 } }],
      ['spending_total', { period: { kind: 'last_days', days: 0 } }],
      ['spending_total', { period: { kind: 'month', offset: 1 } }],
      ['spending_total', { period: { kind: 'month', year: 2026, month: 13 } }],
      ['spending_total', { period: { kind: 'month', offset: 0 }, extra: 1 }],
      ['top_merchants', { period: { kind: 'month', offset: 0 }, limit: 11 }],
      ['top_merchants', { period: { kind: 'month', offset: 0 }, limit: 0 }],
      ['compare_periods', { periodA: { kind: 'month', offset: 0 } }],
      ['budget_status', { period: 1 }],
      ['spending_by_category', 'nope'],
    ];
    for (const [name, input] of bad) {
      expect(await executeTool(name, input, ctx())).toEqual({ ok: false, error: 'invalid_input' });
    }
  });

  it('rejects unknown tools', async () => {
    expect(await executeTool('delete_everything', {}, ctx())).toEqual({
      ok: false,
      error: 'unknown_tool',
    });
  });

  it('does not leak repo errors', async () => {
    const repos = seedRepos();
    repos.transactions.listBetween = async () => {
      throw new Error('secret merchant text');
    };
    const out = await executeTool(
      'spending_total',
      { period: { kind: 'month', offset: 0 } },
      context(repos),
    );
    expect(out).toEqual({ ok: false, error: 'failed' });
  });
});

describe('spending tools', () => {
  it('spending_total excludes transfers, income, duplicates, unlinked refunds, deleted and other currencies', async () => {
    const out = await run(
      'spending_total',
      { period: { kind: 'month', offset: 0 } },
      context(seedRepos()),
    );
    expect(out).toEqual({
      period: { label: 'October 2026', from: '2026-10-01', to: '2026-11-01' },
      currency: 'USD',
      totalMinor: 29599,
      transactionCount: 7,
    });
  });

  it('accepts explicit months and last_days', async () => {
    const ctx = context(seedRepos());
    expect(
      (await run('spending_total', { period: { kind: 'month', year: 2026, month: 9 } }, ctx))
        .totalMinor,
    ).toBe(25000);
    expect(
      (await run('spending_total', { period: { kind: 'last_days', days: 7 } }, ctx)).totalMinor,
    ).toBe(2500 + 1099 + 1500 /* Oct 9 */ + 0);
  });

  it('spending_by_category nets linked refunds and sorts', async () => {
    const out = await run(
      'spending_by_category',
      { period: { kind: 'month', offset: 0 } },
      context(seedRepos()),
    );
    expect(out['categories']).toEqual([
      { categoryId: 'food.groceries', name: 'Groceries', amountMinor: 20000 },
      { categoryId: 'food.coffee', name: 'Coffee', amountMinor: 3000 },
      { categoryId: 'food.dining', name: 'Dining Out', amountMinor: 3000 },
      { categoryId: 'gifts.general', name: 'Gifts & Giving', amountMinor: 2500 },
      { categoryId: 'subscriptions.general', name: 'Subscriptions', amountMinor: 1099 },
    ]);
    expect(out['totalMinor']).toBe(29599);
  });

  it('top_merchants groups by merchant, honors limit', async () => {
    const out = await run(
      'top_merchants',
      { period: { kind: 'month', offset: 0 }, limit: 3 },
      context(seedRepos()),
    );
    expect(out['merchants']).toEqual([
      { name: "Trader Joe's", amountMinor: 12000, transactionCount: 1 },
      { name: 'Whole Foods Market', amountMinor: 8000, transactionCount: 1 },
      { name: 'Starbucks', amountMinor: 3000, transactionCount: 2 },
    ]);
    expect(out['truncated']).toBe(true);
  });

  it('compare_periods returns difference, percent and category movers', async () => {
    const out = await run(
      'compare_periods',
      { periodA: { kind: 'month', offset: 0 }, periodB: { kind: 'month', offset: -1 } },
      context(seedRepos()),
    );
    expect(out['periodA'].totalMinor).toBe(29599);
    expect(out['periodB'].totalMinor).toBe(25000);
    expect(out['differenceMinor']).toBe(4599);
    expect(out['percentChange']).toBe(18.4);
    expect(out['categories'][0]).toEqual({
      categoryId: 'food.coffee',
      name: 'Coffee',
      aMinor: 3000,
      bMinor: 0,
      deltaMinor: 3000,
    });
  });

  it('compare_periods gives a null percent when the base is zero', async () => {
    const out = await run(
      'compare_periods',
      { periodA: { kind: 'month', offset: 0 }, periodB: { kind: 'month', offset: -3 } },
      context(seedRepos()),
    );
    expect(out['percentChange']).toBeNull();
  });
});

describe('budget_status and upcoming_subscriptions', () => {
  it('reports pace per budget', async () => {
    const repos = seedRepos();
    for (const b of [
      budget({ categoryId: null, amountMinor: 100000 }),
      budget({ categoryId: 'food.groceries', amountMinor: 30000 }),
      budget({ categoryId: 'food.coffee', amountMinor: 2500 }),
    ]) {
      repos.budgets.rows.set(b.id, b);
    }
    const out = await run('budget_status', {}, context(repos));
    const byName = Object.fromEntries(out['budgets'].map((b: any) => [b.name, b]));
    expect(byName['Overall']).toMatchObject({
      spentMinor: 29599,
      percentUsed: 29.6,
      status: 'on_track',
    });
    expect(byName['Groceries']).toMatchObject({
      spentMinor: 20000,
      remainingMinor: 10000,
      status: 'a_little_ahead',
    });
    expect(byName['Coffee']).toMatchObject({ spentMinor: 3000, remainingMinor: 0, status: 'over' });
    expect(out['budgets'][0].name).toBe('Overall');
  });

  it('lists charges in the next 30 days', async () => {
    const repos = seedRepos();
    const netflix = subscription();
    const late = subscription({
      merchantName: 'Gym',
      amountMinor: 3000,
      nextDueAt: '2026-12-20T12:00:00.000Z',
    });
    const weekly = subscription({
      merchantName: 'Paper',
      amountMinor: 500,
      cadence: 'weekly',
      nextDueAt: '2026-10-17T12:00:00.000Z',
    });
    for (const s of [netflix, late, weekly]) repos.subscriptions.rows.set(s.id, s);
    const out = await run('upcoming_subscriptions', {}, context(repos));
    expect(out['subscriptions'].map((s: any) => `${s.merchant}@${s.dueDate}`)).toEqual([
      'Paper@2026-10-17',
      'Netflix@2026-10-20',
      'Paper@2026-10-24',
      'Paper@2026-10-31',
      'Paper@2026-11-07',
      'Paper@2026-11-14',
    ]);
    expect(out['totalMinor']).toBe(1549 + 500 * 5);
  });
});

describe('cloud privacy', () => {
  const cloud = () => context(seedRepos(), { privacy: 'cloud' });
  const month = { kind: 'month', offset: 0 };

  it('merges payments to people into one nameless bucket', async () => {
    const out = await run('top_merchants', { period: month, limit: 10 }, cloud());
    const names = out['merchants'].map((m: any) => m.name);
    expect(names).toContain(PEOPLE_BUCKET_NAME);
    expect(names).not.toContain(PERSON_NAME);
    expect(out['merchants'].find((m: any) => m.name === PEOPLE_BUCKET_NAME).amountMinor).toBe(2500);
    // A P2P payment to a dictionary merchant keeps its (business) name.
    expect(names).toContain('Spotify');
  });

  it('names only well-known chains; local businesses share one bucket', async () => {
    const repos = createInMemoryRepos();
    const local = 'Sunrise Pediatrics';
    for (const t of [
      tx({ merchantName: local, amountMinor: 8000, occurredAt: '2026-10-10T15:00:00.000Z' }),
      tx({ merchantName: 'Starbucks', amountMinor: 600, occurredAt: '2026-10-11T15:00:00.000Z' }),
    ]) {
      await repos.transactions.insert(t);
    }
    const out = await run(
      'top_merchants',
      { period: month, limit: 10 },
      context(repos, { privacy: 'cloud' }),
    );
    const names = out['merchants'].map((m: any) => m.name);
    expect(names).toContain(OTHER_MERCHANTS_BUCKET_NAME);
    expect(names).toContain('Starbucks');
    expect(JSON.stringify(out)).not.toContain(local);

    const localOut = await run(
      'top_merchants',
      { period: month, limit: 10 },
      context(repos, { privacy: 'local' }),
    );
    expect(localOut['merchants'].map((m: any) => m.name)).toContain(local);
  });

  it('local mode still shows the person', async () => {
    const out = await run('top_merchants', { period: month, limit: 10 }, context(seedRepos()));
    expect(out['merchants'].map((m: any) => m.name)).toContain(PERSON_NAME);
  });

  it('never exposes notes, raw descriptors, account digits, ids or rows in any tool', async () => {
    const repos = seedRepos();
    for (const b of [budget({ categoryId: null })]) repos.budgets.rows.set(b.id, b);
    repos.subscriptions.rows.set('s', subscription());
    const ctx = context(repos, { privacy: 'cloud' });
    const inputs: [string, unknown][] = [
      ['spending_total', { period: month }],
      ['spending_by_category', { period: month }],
      ['top_merchants', { period: month, limit: 10 }],
      ['compare_periods', { periodA: month, periodB: { kind: 'month', offset: -1 } }],
      ['budget_status', {}],
      ['upcoming_subscriptions', {}],
    ];
    const forbidden = [
      PERSON_NAME,
      'Jane',
      'Quill',
      SECRET_NOTE,
      'VENMO',
      '4242',
      'note',
      'merchantRaw',
      'occurredAt',
      'accountLast4',
      'txnRef',
      '20000000-0000',
    ];
    for (const [name, input] of inputs) {
      const json = JSON.stringify(await run(name, input, ctx));
      for (const word of forbidden) expect(json).not.toContain(word);
      expect(jsonBytes(JSON.parse(json))).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES);
    }
  });
});

describe('truncation', () => {
  it('keeps big results under the cap', async () => {
    const repos = createInMemoryRepos();
    for (let i = 0; i < 120; i++) {
      const row = tx({
        merchantName: `Very Long Synthetic Merchant Name Number ${i} `.repeat(3),
        categoryId: `custom.category_number_${i}_${'x'.repeat(20)}` as never,
        amountMinor: 1000 + i,
      });
      repos.transactions.rows.set(row.id, row);
      const sub = subscription({
        merchantName: `Subscription Service With A Long Name ${i}`.repeat(2),
        nextDueAt: '2026-10-20T12:00:00.000Z',
      });
      repos.subscriptions.rows.set(sub.id, sub);
    }
    const ctx = context(repos as never, { privacy: 'cloud' });
    const month = { kind: 'month', offset: 0 };
    const cats = await run('spending_by_category', { period: month }, ctx);
    expect(cats['truncated']).toBe(true);
    expect(cats['categories'].length).toBeLessThanOrEqual(30);
    expect(jsonBytes(cats)).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES);
    const subs = await run('upcoming_subscriptions', {}, ctx);
    expect(subs['truncated']).toBe(true);
    expect(jsonBytes(subs)).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES);
    const cmp = await run(
      'compare_periods',
      { periodA: month, periodB: { kind: 'month', offset: -1 } },
      ctx,
    );
    expect(jsonBytes(cmp)).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES);
    // Cloud mode buckets unknown merchants into one entry; local mode lists them individually.
    const topCloud = await run('top_merchants', { period: month, limit: 10 }, ctx);
    expect(topCloud['merchants'].length).toBe(1);
    const localCtx = context(repos as never, { privacy: 'local' });
    const top = await run('top_merchants', { period: month, limit: 10 }, localCtx);
    expect(top['merchants'].length).toBe(10);
    expect(jsonBytes(top)).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES);
  });

  it('fitOutput drops from the longest list and flags it', () => {
    const out = fitOutput(
      { a: Array.from({ length: 500 }, (_, i) => ({ i, pad: 'x'.repeat(20) })), b: [1] },
      1000,
    );
    expect(jsonBytes(out)).toBeLessThanOrEqual(1000);
    expect(out['truncated' as never]).toBe(true);
    expect(out.b).toEqual([1]);
  });
});
