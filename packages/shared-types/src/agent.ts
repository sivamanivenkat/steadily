import type { CategoryId } from '@steadily/taxonomy';
import type { EventType, NewEvent, StoredEvent } from './events';

/** Which LLM tier is usable right now, given device support and user settings. */
export type LlmTier = 'none' | 'on_device' | 'cloud';

/**
 * The only path to an LLM. Cloud is used only when the user opted in (D-011),
 * and receives minimal payloads: merchant text + amount, never raw alerts.
 */
export interface LlmPort {
  tier(): Promise<LlmTier>;
  /** Constrained choice: the result is always one of `allowed`, or null. */
  chooseCategory(input: {
    merchant: string;
    amountMinor: number;
    allowed: readonly CategoryId[];
  }): Promise<{ categoryId: CategoryId; confidence: number } | null>;
}

/** Logging that cannot carry transaction data: message + ids only. */
export interface AgentLogger {
  info(message: string, meta?: { eventId?: string; agent?: string }): void;
  warn(message: string, meta?: { eventId?: string; agent?: string }): void;
  error(message: string, meta?: { eventId?: string; agent?: string }): void;
}

export interface AgentContext {
  now(): Date;
  llm: LlmPort;
  log: AgentLogger;
}

/**
 * Every runtime agent (D-017). Handlers must be idempotent: the bus may
 * deliver an event again after a crash, and records processed event ids.
 */
export interface Agent<TContext extends AgentContext = AgentContext> {
  readonly name: string;
  readonly subscribes: readonly EventType[];
  handle(event: StoredEvent, ctx: TContext): Promise<NewEvent[]>;
  /**
   * Optional periodic work (app foreground, background task). Returned events
   * are published with no causation. Must be safe to call at any frequency:
   * the agent decides itself whether anything is due.
   */
  tick?(ctx: TContext): Promise<NewEvent[]>;
}
