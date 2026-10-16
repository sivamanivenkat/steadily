/**
 * The app's agent runtime (D-017, D-018): one `AgentRuntime` over the SQLite event store with
 * every MVP agent registered. Platform-free so tests can build it on a Node database; the app
 * passes expo-crypto ids (see `appDataSource.ts`).
 */
import {
  AgentRuntime,
  createBudgetCoach,
  createCategorizerAgent,
  createHousekeepingAgent,
  createNoopLlm,
  createNotifier,
  createParserAgent,
  createReconcilerAgent,
  createSubscriptionWatcher,
  type Clock,
  type IdGenerator,
  type NotificationSink,
} from '@steadily/agent-core';
import { createRepos, SqliteEventStore, type SteadilyDb } from '@steadily/db';
import type { AgentLogger } from '@steadily/shared-types';

import { createSettingsCheckinStore } from './appSettings';

export type AppRepos = ReturnType<typeof createRepos>;

export type AppRuntime = { runtime: AgentRuntime; repos: AppRepos };

/**
 * Agent logs (D-011). Production: nothing. Development: level, agent name and event id only,
 * never the message text, so nothing a handler might have put there reaches the console.
 */
export function createAppLogger(dev: boolean): AgentLogger {
  if (!dev) return { info() {}, warn() {}, error() {} };
  const at =
    (level: 'info' | 'warn' | 'error') =>
    (_message: string, meta?: { eventId?: string; agent?: string }) => {
      console[level](`[agents] ${level} agent=${meta?.agent ?? '-'} event=${meta?.eventId ?? '-'}`);
    };
  return { info: at('info'), warn: at('warn'), error: at('error') };
}

/**
 * Stand-in until the native notification layer exists (D-012). It receives ids only and drops
 * them; the review queue and the Home screen still show everything.
 */
export const placeholderNotificationSink: NotificationSink = {
  async deliver() {},
  async queueForSummary() {},
};

export type AppRuntimeOptions = {
  newId: IdGenerator;
  clock?: Clock;
  log?: AgentLogger;
  sink?: NotificationSink;
  /** IANA zone for month boundaries and quiet hours; defaults to the device zone. */
  timeZone?: string;
};

export function createAppRuntime(db: SteadilyDb, options: AppRuntimeOptions): AppRuntime {
  const repos = createRepos(db);
  const clock = options.clock ?? (() => new Date());
  const zone = options.timeZone ? { timeZone: options.timeZone } : {};
  const runtime = new AgentRuntime({
    store: new SqliteEventStore(db),
    // No on-device model yet and cloud AI is not wired: the categorizer never asks an LLM.
    llm: createNoopLlm(),
    log: options.log ?? createAppLogger(__DEV__),
    clock,
    newId: options.newId,
  });

  runtime
    .register(createParserAgent({ repos }))
    .register(createCategorizerAgent({ repos, newId: options.newId, ...zone }))
    .register(createReconcilerAgent({ repos }))
    .register(
      createBudgetCoach({
        transactions: repos.transactions,
        budgets: repos.budgets,
        lastCheckinStore: createSettingsCheckinStore(db, clock),
        ...zone,
      }),
    )
    .register(
      createSubscriptionWatcher({
        transactions: repos.transactions,
        subscriptions: repos.subscriptions,
        newId: options.newId,
      }),
    )
    .register(
      createNotifier({
        settings: repos.settings,
        sink: options.sink ?? placeholderNotificationSink,
        ...zone,
      }),
    )
    .register(createHousekeepingAgent({ repos }));

  return { runtime, repos };
}
