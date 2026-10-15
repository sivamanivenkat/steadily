import type { Agent, AgentContext, AgentLogger, LlmPort } from '@steadily/shared-types';
import { EventBus, type Clock, type IdGenerator, systemClock } from './event-bus';
import type { EventStore, FailureRecord } from './event-store';

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

export interface TickResult {
  /** Agents that have a `tick`. */
  ticked: number;
  /** Events published from ticks. */
  published: number;
  /** Ticks that threw or returned invalid events (nothing published for them). */
  failed: number;
  /** The delivery run that followed. */
  run: RunResult;
}

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_MAX_DELIVERIES_PER_RUN = 1000;
const DEFAULT_BATCH_SIZE = 100;
/** Longest error name stored in `failed_events`. */
const MAX_ERROR_NAME_LENGTH = 100;

/**
 * Name of an agent's delivery cursor in the store. It includes the agent's
 * subscriptions, so an agent that subscribes to a new event type after an
 * update gets a fresh cursor and sees the older events of that type.
 */
export function agentCursorName(agent: Pick<Agent, 'name' | 'subscribes'>): string {
  return `agent:${agent.name}|${[...agent.subscribes].sort().join(',')}`;
}

/**
 * Delivers bus events to subscribed agents (D-017).
 *
 * - Events are delivered in seq order; for one event, agents run in registration order.
 * - Idempotent: an (agent, event) pair is handled once, recorded in `processed_events`.
 * - Emitted events and the processed marker are committed atomically, only on success.
 * - A failing agent never blocks other agents; it is retried on the next run, up to
 *   `maxAttempts`, then the event is skipped for that agent (marked processed).
 * - If the store supports it, retry counts (`failed_events`) and per-agent delivery
 *   cursors (`runtime_cursors`) are persisted, so they survive app restarts and a
 *   restarted runtime scans from each agent's cursor instead of seq 0.
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
  /** Failure counts per (agent, event), used only when the store cannot persist them. */
  private readonly attempts = new Map<string, number>();
  /**
   * Per agent: every event at or below this seq is settled (processed or given up).
   * Loaded lazily from the store's cursor on the first run after `register`.
   */
  private readonly settled = new Map<string, number>();
  /** Last cursor value written to (or read from) the store, per agent. */
  private readonly persisted = new Map<string, number>();
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
    // A new agent starts from its stored cursor, or from seq 0 if it has none.
    this.agents.push(agent);
    return this;
  }

  /** Delivers pending events until none are left. Concurrent calls are serialized. */
  runUntilIdle(): Promise<RunResult> {
    const run = this.running.then(() => this.runOnce());
    this.running = run.catch(() => undefined);
    return run;
  }

  /**
   * Periodic entry point (app foreground, background task, Headless JS): calls
   * every registered agent's `tick` in registration order, publishes what each
   * returns (causationId null), then delivers until idle. A failing or invalid
   * tick is logged by error name and skipped; other agents still tick.
   * Serialized with `runUntilIdle`.
   */
  tick(): Promise<TickResult> {
    const run = this.running.then(() => this.tickOnce());
    this.running = run.catch(() => undefined);
    return run;
  }

  private async tickOnce(): Promise<TickResult> {
    let ticked = 0;
    let published = 0;
    let failed = 0;
    for (const agent of this.agents) {
      if (!agent.tick) continue;
      ticked++;
      try {
        const emitted = await agent.tick(this.ctx);
        published += (await this.bus.publish(emitted, null)).length;
      } catch (error) {
        failed++;
        const reason =
          error instanceof Error ? error.name.slice(0, MAX_ERROR_NAME_LENGTH) : 'non-error thrown';
        this.log.warn(`Agent tick failed (${reason})`, { agent: agent.name });
      }
    }
    const run = await this.runOnce();
    return { ticked, published, failed, run };
  }

  private async runOnce(): Promise<RunResult> {
    const result: RunResult = {
      deliveries: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      stoppedByLoopGuard: false,
    };
    if (this.agents.length === 0) return result;
    await this.loadCursors();

    // Pairs that failed in this run wait for the next run.
    const failedThisRun = new Set<string>();
    // Agents whose settled prefix can still advance in this run.
    const advancing = new Set(this.agents.map((agent) => agent.name));
    let scanSeq = Math.min(...this.agents.map((agent) => this.settledSeq(agent)));

    try {
      for (;;) {
        const batch = await this.store.readAfter(scanSeq, this.batchSize);
        if (batch.length === 0) break;

        for (const { seq, event } of batch) {
          for (const agent of this.agents) {
            if (seq <= this.settledSeq(agent)) continue;
            let pairSettled = true;

            if (agent.subscribes.includes(event.type)) {
              const key = pairKey(agent.name, event.id);
              if (failedThisRun.has(key)) {
                pairSettled = false;
              } else if (!(await this.store.isProcessed(agent.name, event.id))) {
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
                  // Error messages may echo payload values, so only the error name is kept.
                  const reason =
                    error instanceof Error
                      ? error.name.slice(0, MAX_ERROR_NAME_LENGTH)
                      : 'non-error thrown';
                  const attempt = (await this.failureAttempts(agent.name, event.id)) + 1;
                  const gaveUp = attempt >= this.maxAttempts;
                  await this.recordFailure({
                    agent: agent.name,
                    eventId: event.id,
                    attempts: attempt,
                    errorName: reason,
                    gaveUp,
                    at: this.clock().toISOString(),
                  });
                  if (gaveUp) {
                    result.skipped++;
                    this.log.error(`Agent failed ${attempt} times (${reason}); skipping event`, {
                      agent: agent.name,
                      eventId: event.id,
                    });
                  } else {
                    failedThisRun.add(key);
                    pairSettled = false;
                    this.log.warn(
                      `Agent failed (${reason}), attempt ${attempt}/${this.maxAttempts}; will retry`,
                      { agent: agent.name, eventId: event.id },
                    );
                  }
                }
              }
            }

            if (!pairSettled) advancing.delete(agent.name);
            else if (advancing.has(agent.name)) this.settled.set(agent.name, seq);
          }
          scanSeq = seq;
        }
        await this.persistCursors();
      }
    } finally {
      await this.persistCursors();
    }
    return result;
  }

  private settledSeq(agent: Agent): number {
    return this.settled.get(agent.name) ?? 0;
  }

  private async loadCursors(): Promise<void> {
    for (const agent of this.agents) {
      if (this.settled.has(agent.name)) continue;
      const stored = this.store.getCursor
        ? await this.store.getCursor(agentCursorName(agent))
        : null;
      this.settled.set(agent.name, stored ?? 0);
      this.persisted.set(agent.name, stored ?? 0);
    }
  }

  /** Writes cursors that moved since the last write. Stale cursors are safe, just slower. */
  private async persistCursors(): Promise<void> {
    if (!this.store.setCursor) return;
    const at = this.clock().toISOString();
    for (const agent of this.agents) {
      const seq = this.settledSeq(agent);
      if (this.persisted.get(agent.name) === seq) continue;
      await this.store.setCursor(agentCursorName(agent), seq, at);
      this.persisted.set(agent.name, seq);
    }
  }

  private get persistsFailures(): boolean {
    return this.store.getFailureAttempts !== undefined && this.store.recordFailure !== undefined;
  }

  private async failureAttempts(agent: string, eventId: string): Promise<number> {
    if (this.persistsFailures) return this.store.getFailureAttempts!(agent, eventId);
    return this.attempts.get(pairKey(agent, eventId)) ?? 0;
  }

  private async recordFailure(failure: FailureRecord): Promise<void> {
    if (this.persistsFailures) return this.store.recordFailure!(failure);
    const key = pairKey(failure.agent, failure.eventId);
    if (failure.gaveUp) {
      this.attempts.delete(key);
      await this.store.markProcessed(failure.agent, failure.eventId, failure.at);
    } else {
      this.attempts.set(key, failure.attempts);
    }
  }
}

function pairKey(agent: string, eventId: string): string {
  return `${agent}\u0000${eventId}`;
}
