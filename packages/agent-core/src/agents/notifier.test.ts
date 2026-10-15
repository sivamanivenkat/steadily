import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings, type StoredEvent } from '@steadily/shared-types';
import { InMemorySettingsRepo } from '../ports';
import { createCapturingLogger, createFixedClock, createNoopLlm } from '../testing';
import {
  createNotifier,
  decideNotification,
  inQuietHours,
  InMemoryNotificationSink,
  type NotificationKind,
  type NotifyDecision,
} from './notifier';

// Synthetic data only.
const id = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const NY = 'America/New_York';

const MODES: Settings['notifyMode'][] = ['unsure_only', 'every_transaction', 'off'];
const KINDS: NotificationKind[] = [
  'transaction_logged',
  'transaction_needs_review',
  'budget_warning',
  'subscription_price_up',
  'weekly_checkin',
  'daily_summary',
];
const URGENCIES = ['instant', 'summary'] as const;

const NOON = 12 * 60;
const MIDNIGHT = 0;
const settingsFor = (
  notifyMode: Settings['notifyMode'],
  dailySummary = true,
): Pick<Settings, 'notifyMode' | 'dailySummary' | 'quietHours'> => ({
  notifyMode,
  dailySummary,
  quietHours: { start: '22:00', end: '07:00' },
});

/**
 * Expected outcome for every mode × kind with an instant request outside quiet
 * hours. Written out in full so the table reads as the spec (D-012).
 */
const INSTANT_DAYTIME: Record<Settings['notifyMode'], Record<NotificationKind, NotifyDecision>> = {
  unsure_only: {
    transaction_logged: 'summary',
    transaction_needs_review: 'deliver',
    budget_warning: 'summary',
    subscription_price_up: 'summary',
    weekly_checkin: 'summary',
    daily_summary: 'deliver',
  },
  every_transaction: {
    transaction_logged: 'deliver',
    transaction_needs_review: 'deliver',
    budget_warning: 'summary',
    subscription_price_up: 'summary',
    weekly_checkin: 'summary',
    daily_summary: 'deliver',
  },
  off: {
    transaction_logged: 'drop',
    transaction_needs_review: 'summary',
    budget_warning: 'drop',
    subscription_price_up: 'drop',
    weekly_checkin: 'drop',
    daily_summary: 'deliver',
  },
};

describe('decideNotification: full decision table', () => {
  for (const mode of MODES) {
    for (const kind of KINDS) {
      for (const urgency of URGENCIES) {
        for (const quiet of [false, true]) {
          for (const dailySummary of [true, false]) {
            const minute = quiet ? MIDNIGHT : NOON;
            const label = `${mode} / ${kind} / ${urgency} / ${quiet ? 'quiet' : 'daytime'} / summary ${dailySummary ? 'on' : 'off'}`;
            it(label, () => {
              const base = INSTANT_DAYTIME[mode][kind];
              let expected: NotifyDecision;
              if (kind === 'daily_summary') {
                expected = dailySummary && !quiet ? 'deliver' : 'drop';
              } else {
                expected =
                  base === 'deliver' && (urgency === 'summary' || quiet) ? 'summary' : base;
                if (expected === 'summary' && !dailySummary) expected = 'drop';
              }
              expect(
                decideNotification({ kind, urgency }, settingsFor(mode, dailySummary), minute),
              ).toBe(expected);
            });
          }
        }
      }
    }
  }
});

describe('decideNotification: invariants', () => {
  it('never delivers during quiet hours or for summary-urgency requests', () => {
    for (const mode of MODES) {
      for (const kind of KINDS) {
        expect(
          decideNotification({ kind, urgency: 'instant' }, settingsFor(mode), MIDNIGHT),
        ).not.toBe('deliver');
        if (kind !== 'daily_summary') {
          expect(
            decideNotification({ kind, urgency: 'summary' }, settingsFor(mode), NOON),
          ).not.toBe('deliver');
        }
      }
    }
  });

  it('in off mode keeps only needs-review (in the summary) and the summary itself', () => {
    const kept = KINDS.filter(
      (kind) =>
        decideNotification({ kind, urgency: 'instant' }, settingsFor('off'), NOON) !== 'drop',
    );
    expect(kept).toEqual(['transaction_needs_review', 'daily_summary']);
  });

  it('delivers needs-review instantly in both active modes when not quiet', () => {
    for (const mode of ['unsure_only', 'every_transaction'] as const) {
      expect(
        decideNotification(
          { kind: 'transaction_needs_review', urgency: 'instant' },
          { ...settingsFor(mode), quietHours: null },
          MIDNIGHT,
        ),
      ).toBe('deliver');
    }
  });
});

describe('inQuietHours', () => {
  const at = (h: number, m = 0) => h * 60 + m;

  it('wraps past midnight, start inclusive, end exclusive', () => {
    const quiet = { start: '22:00', end: '07:00' };
    expect(inQuietHours(at(21, 59), quiet)).toBe(false);
    expect(inQuietHours(at(22), quiet)).toBe(true);
    expect(inQuietHours(at(3), quiet)).toBe(true);
    expect(inQuietHours(at(6, 59), quiet)).toBe(true);
    expect(inQuietHours(at(7), quiet)).toBe(false);
  });

  it('handles same-day ranges, equal ends and no quiet hours', () => {
    const nap = { start: '13:00', end: '14:30' };
    expect(inQuietHours(at(12, 59), nap)).toBe(false);
    expect(inQuietHours(at(14, 29), nap)).toBe(true);
    expect(inQuietHours(at(14, 30), nap)).toBe(false);
    expect(inQuietHours(at(3), { start: '08:00', end: '08:00' })).toBe(false);
    expect(inQuietHours(at(3), null)).toBe(false);
  });
});

describe('Notifier agent', () => {
  function setup(settings: Partial<Settings> = {}, now = '2026-10-15T16:00:00.000Z') {
    const sink = new InMemoryNotificationSink();
    const repo = new InMemorySettingsRepo({ ...DEFAULT_SETTINGS, ...settings });
    const ctx = { now: createFixedClock(now), llm: createNoopLlm(), log: createCapturingLogger() };
    const agent = createNotifier({ settings: repo, sink, timeZone: NY });
    return { sink, ctx, agent, repo };
  }

  function request(
    n: number,
    payload: Extract<StoredEvent, { type: 'notify.request' }>['payload'],
  ): StoredEvent {
    return {
      id: id(n),
      type: 'notify.request',
      at: '2026-10-15T16:00:00.000Z',
      causationId: null,
      payload,
    };
  }

  it('delivers ids only and emits nothing', async () => {
    const { sink, ctx, agent } = setup();
    const out = await agent.handle(
      request(1, { kind: 'transaction_needs_review', urgency: 'instant', transactionId: id(7) }),
      ctx,
    );
    expect(out).toEqual([]);
    expect(sink.delivered).toEqual([
      { requestId: id(1), kind: 'transaction_needs_review', transactionId: id(7) },
    ]);
    expect(sink.queued).toEqual([]);
  });

  it('strips anything that is not an id, even if a payload carries it', async () => {
    const { sink, ctx, agent } = setup({ notifyMode: 'every_transaction' });
    const payload = {
      kind: 'transaction_logged' as const,
      urgency: 'instant' as const,
      transactionId: id(7),
      merchantName: 'SYNTHETIC SECRET',
      amountMinor: 4520,
    };
    await agent.handle(request(1, payload), ctx);
    expect(Object.keys(sink.delivered[0] ?? {}).sort()).toEqual([
      'kind',
      'requestId',
      'transactionId',
    ]);
    expect(JSON.stringify(sink.delivered)).not.toContain('SYNTHETIC');
  });

  it('applies quiet hours in the user time zone', async () => {
    // 03:00 UTC is 23:00 in New York: quiet.
    const { sink, ctx, agent } = setup({}, '2026-10-15T03:00:00.000Z');
    await agent.handle(
      request(1, { kind: 'transaction_needs_review', urgency: 'instant', transactionId: id(7) }),
      ctx,
    );
    expect(sink.delivered).toEqual([]);
    expect(sink.queued).toEqual([
      { requestId: id(1), kind: 'transaction_needs_review', transactionId: id(7) },
    ]);
  });

  it('reads settings on every request', async () => {
    const { sink, ctx, agent, repo } = setup();
    const logged = { kind: 'transaction_logged' as const, urgency: 'instant' as const };
    await agent.handle(request(1, logged), ctx);
    repo.value = { ...repo.value, notifyMode: 'every_transaction' };
    await agent.handle(request(2, logged), ctx);
    repo.value = { ...repo.value, notifyMode: 'off' };
    await agent.handle(request(3, logged), ctx);
    expect(sink.queued.map((n) => n.requestId)).toEqual([id(1)]);
    expect(sink.delivered.map((n) => n.requestId)).toEqual([id(2)]);
  });

  it('passes budget and subscription ids through', async () => {
    const { sink, ctx, agent } = setup();
    await agent.handle(
      request(1, {
        kind: 'budget_warning',
        urgency: 'instant',
        budgetId: id(5),
        transactionId: id(7),
      }),
      ctx,
    );
    await agent.handle(
      request(2, { kind: 'subscription_price_up', urgency: 'instant', subscriptionId: id(6) }),
      ctx,
    );
    expect(sink.queued).toEqual([
      { requestId: id(1), kind: 'budget_warning', transactionId: id(7), budgetId: id(5) },
      { requestId: id(2), kind: 'subscription_price_up', subscriptionId: id(6) },
    ]);
  });
});
