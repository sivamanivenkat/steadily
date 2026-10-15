import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@steadily/shared-types';
import { InMemoryEventStore } from '../event-store';
import { createInMemoryRepos, type InboxItem } from '../ports';
import { AgentRuntime } from '../runtime';
import {
  createCapturingLogger,
  createFixedClock,
  createNoopLlm,
  createSequentialIds,
} from '../testing';
import { createBudgetCoach, InMemoryLastCheckinStore } from './budget-coach';
import { createHousekeepingAgent } from './housekeeping';
import { createNotifier, InMemoryNotificationSink } from './notifier';

// Synthetic data only.
const SECRET = 'SYNTHETIC ALERT TEXT 4821';
const NY = 'America/New_York';

function inboxItem(id: string, expiresAt: string): InboxItem {
  return {
    id,
    createdAt: '2026-10-10T12:00:00.000Z',
    expiresAt,
    source: 'android_notification',
    rawText: SECRET,
    originApp: 'com.example.bank',
    originSender: null,
  };
}

const EXPIRED = '00000000-0000-4000-8000-0000000000b1';
const FRESH = '00000000-0000-4000-8000-0000000000b2';

describe('Housekeeping agent', () => {
  it('purges expired inbox items on tick and logs only the count', async () => {
    const repos = createInMemoryRepos();
    repos.inbox.rows.set(EXPIRED, inboxItem(EXPIRED, '2026-10-17T12:00:00.000Z'));
    repos.inbox.rows.set(FRESH, inboxItem(FRESH, '2026-10-25T12:00:00.000Z'));
    const log = createCapturingLogger();
    const ctx = { now: createFixedClock('2026-10-18T12:00:00.000Z'), llm: createNoopLlm(), log };
    const agent = createHousekeepingAgent({ repos });

    expect(await agent.tick!(ctx)).toEqual([]);
    expect([...repos.inbox.rows.keys()]).toEqual([FRESH]);
    expect(log.entries).toEqual([
      {
        level: 'info',
        message: 'Purged 1 expired inbox item(s)',
        meta: { agent: 'housekeeping' },
      },
    ]);

    // Nothing left to purge: no log line.
    expect(await agent.tick!(ctx)).toEqual([]);
    expect(log.entries).toHaveLength(1);
    expect(JSON.stringify(log.entries)).not.toContain(SECRET);
  });

  it('subscribes to nothing', async () => {
    const agent = createHousekeepingAgent({ repos: createInMemoryRepos() });
    expect(agent.subscribes).toEqual([]);
  });
});

describe('replay: scheduled tick', () => {
  it('purges the inbox and sends the weekly check-in once', async () => {
    const repos = createInMemoryRepos();
    repos.settings.value = { ...DEFAULT_SETTINGS, notifyMode: 'every_transaction' };
    repos.inbox.rows.set(EXPIRED, inboxItem(EXPIRED, '2026-10-17T12:00:00.000Z'));
    const sink = new InMemoryNotificationSink();
    const store = new InMemoryEventStore();
    const log = createCapturingLogger();
    // Sunday 2026-10-18, 18:05 in New York.
    const clock = createFixedClock('2026-10-18T22:05:00.000Z');
    const runtime = new AgentRuntime({
      store,
      log,
      clock,
      newId: createSequentialIds(),
      llm: createNoopLlm(),
    });
    runtime
      .register(createHousekeepingAgent({ repos }))
      .register(
        createBudgetCoach({
          transactions: repos.transactions,
          budgets: repos.budgets,
          timeZone: NY,
          lastCheckinStore: new InMemoryLastCheckinStore(),
        }),
      )
      .register(createNotifier({ settings: repos.settings, sink, timeZone: NY }));

    const first = await runtime.tick();
    clock.advance(60 * 60 * 1000);
    const second = await runtime.tick();

    expect(first).toMatchObject({ ticked: 2, published: 1, failed: 0 });
    expect(second).toMatchObject({ ticked: 2, published: 0, failed: 0 });
    expect(repos.inbox.rows.size).toBe(0);
    expect(store.all().map(({ event }) => [event.type, event.causationId, event.payload])).toEqual([
      ['notify.request', null, { kind: 'weekly_checkin', urgency: 'instant' }],
    ]);
    // The Notifier's table sends the check-in to the daily summary.
    expect(sink.queued.map((n) => n.kind)).toEqual(['weekly_checkin']);
    expect(sink.delivered).toEqual([]);
    expect(JSON.stringify(log.entries)).not.toContain(SECRET);
  });
});
