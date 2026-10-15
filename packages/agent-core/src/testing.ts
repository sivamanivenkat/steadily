import type { AgentLogger, LlmPort } from '@steadily/shared-types';
import type { Clock } from './event-bus';

/** LLM port for tests and devices without any LLM: tier 'none', never chooses. */
export function createNoopLlm(): LlmPort {
  return {
    tier: async () => 'none',
    chooseCategory: async () => null,
  };
}

export interface LogEntry {
  level: 'info' | 'warn' | 'error';
  message: string;
  meta?: { eventId?: string; agent?: string };
}

export interface CapturingLogger extends AgentLogger {
  readonly entries: LogEntry[];
}

/** Logger that records entries so tests can assert on them. */
export function createCapturingLogger(): CapturingLogger {
  const entries: LogEntry[] = [];
  const at =
    (level: LogEntry['level']) =>
    (message: string, meta?: LogEntry['meta']): void => {
      entries.push(meta === undefined ? { level, message } : { level, message, meta });
    };
  return { entries, info: at('info'), warn: at('warn'), error: at('error') };
}

export interface FixedClock extends Clock {
  set(iso: string): void;
  advance(ms: number): void;
}

/** Clock that returns a fixed instant until moved with `set` or `advance`. */
export function createFixedClock(iso = '2026-10-15T08:00:00.000Z'): FixedClock {
  let current = new Date(iso).getTime();
  const clock = (() => new Date(current)) as FixedClock;
  clock.set = (next) => {
    current = new Date(next).getTime();
  };
  clock.advance = (ms) => {
    current += ms;
  };
  return clock;
}

/** Deterministic uuid-shaped ids: 00000000-0000-4000-8000-000000000001, ... */
export function createSequentialIds(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}`;
}
