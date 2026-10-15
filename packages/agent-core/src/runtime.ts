import type { Agent, AgentContext, AgentLogger, LlmPort } from '@steadily/shared-types';
import { EventBus, type Clock, type IdGenerator, systemClock } from './event-bus';
import type { EventStore } from './event-store';

export interface AgentRuntimeOptions {
  store: EventStore;
  llm: LlmPort;
  log: AgentLogger;
  clock?: Clock;
  newId?: IdGenerator;
  /** Failed attempts per (agent, event) before the event is skipped for that agent. */
  maxAttempts?: number;
  /** Cap on handler invocations per `runUntilIdle()` call (loop guard). */
  maxDeliveriesPerRun?: number;
  /** Events read from the store per page. */
  batchSize?: number;
}

export interface RunResult {
  /** Handler invocations, successful or not. */
  deliveries: number;
  succeeded: number;
  failed: number;
  /** (agent, event) pairs given up on after `maxAttempts` failures. */
  skipped: number;
  stoppedByLoopGuard: boolean;
}

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_MAX_DELIVERIES_PER_RUN = 1000;
const DEFAULT_BATCH_SIZE = 100;

/**
 * Delivers bus events to subscribed agents (D-017).
 *
 * - Events are delivered in seq order; for one event, agents run in registration order.
 * - Idempotent: an (agent, event) pair is handled once, recorded in `processed_events`.
 * - Emitted events and the processed marker are committed atomically, only on success.
 * - A failing agent never blocks other agents; it is retried on the next run, up to
 *   `maxAttempts`, then the event is skipped for that agent (marked processed).
 * - Logs carry messages, agent names and event ids only (D-011).
 */
export class AgentRuntime {
  readonly bus: EventBus;
  private readonly store: EventStore;
  private readonly log: AgentLogger;
  private readonly clock: Clock;
  private readonly ctx: AgentContext;
  private readonly maxAttempts: number;
  private readonly maxDeliveries: number;
  private readonly batchSize: number;
  private readonly agents: Agent[] = [];
  /** Failure counts per (agent, event). In memory: reset when the app restarts. */
  private readonly attempts = new Map<string, number>();
  /** Every event at or below this seq is settled for every registered agent. */
  private settledSeq = 0;
  private running: Promise<unknown> = Promise.resolve();

  constructor(options: AgentRuntimeOptions) {
    this.store = options.store;
    this.log = options.log;
    this.clock = options.clock ?? systemClock;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.maxDeliveries = options.maxDeliveriesPerRun ?? DEFAULT_MAX_DELIVERIES_PER_RUN;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.bus = new EventBus({
      store: options.store,
      clock: this.clock,
      ...(options.newId ? { newId: options.newId } : {}),
    });
    this.ctx = { now: this.clock, llm: options.llm, log: options.log };
  }

  register(agent: Agent): this {
    if (this.agents.some((existing) => existing.name === agent.name)) {
      throw new Error(`Agent already registered: ${agent.name}`);
    }
    this.agents.push(agent);
    // A new agent may have work on old events: rescan from the start.
    this.settledSeq = 0;
    return this;
  }

  /** Delivers pending events until none are left. Concurrent calls are serialized. */
  runUntilIdle(): Promise<RunResult> {
    const run = this.running.then(() => this.runOnce());
    this.running = run.catch(() => undefined);
    return run;
  }

  private async runOnce(): Promise<RunResult> {
    const result: RunResult = {
      deliveries: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      stoppedByLoopGuard: false,
    };
    // Pairs that failed in this run wait for the next run.
    const failedThisRun = new Set<string>();
    let scanSeq = this.settledSeq;
    let prefixSettled = true;

    for (;;) {
      const batch = await this.store.readAfter(scanSeq, this.batchSize);
      if (batch.length === 0) break;

      for (const { seq, event } of batch) {
        let eventSettled = true;
        for (const agent of this.agents) {
          if (!agent.subscribes.includes(event.type)) continue;
          const key = attemptKey(agent.name, event.id);
          if (failedThisRun.has(key)) {
            eventSettled = false;
            continue;
          }
          if (await this.store.isProcessed(agent.name, event.id)) continue;

          if (result.deliveries >= this.maxDeliveries) {
            result.stoppedByLoopGuard = true;
            this.log.warn(
              `Delivery cap of ${this.maxDeliveries} reached; stopping run (possible event loop)`,
              { agent: agent.name, eventId: event.id },
            );
            return result;
          }
          result.deliveries++;

          try {
            const emitted = await agent.handle(event, this.ctx);
            const prepared = this.bus.prepare(emitted, event.id);
            await this.store.recordHandled({
              agent: agent.name,
              eventId: event.id,
              at: this.clock().toISOString(),
              emitted: prepared,
            });
            this.attempts.delete(key);
            result.succeeded++;
          } catch (error) {
            result.failed++;
            const attempt = (this.attempts.get(key) ?? 0) + 1;
            // Error messages may echo payload values, so only the error name is logged.
            const reason = error instanceof Error ? error.name : 'non-error thrown';
            if (attempt >= this.maxAttempts) {
              this.attempts.delete(key);
              await this.store.markProcessed(agent.name, event.id, this.clock().toISOString());
              result.skipped++;
              this.log.error(`Agent failed ${attempt} times (${reason}); skipping event`, {
                agent: agent.name,
                eventId: event.id,
              });
            } else {
              this.attempts.set(key, attempt);
              failedThisRun.add(key);
              eventSettled = false;
              this.log.warn(
                `Agent failed (${reason}), attempt ${attempt}/${this.maxAttempts}; will retry`,
                { agent: agent.name, eventId: event.id },
              );
            }
          }
        }

        scanSeq = seq;
        prefixSettled = prefixSettled && eventSettled;
        if (prefixSettled) this.settledSeq = seq;
      }
    }
    return result;
  }
}

function attemptKey(agent: string, eventId: string): string {
  return `${agent}\u0000${eventId}`;
}
