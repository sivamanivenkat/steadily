import type { ProxyRequestType } from './schemas.ts';

/**
 * Server-side counters. Keys are an anonymous auth user id and a UTC day; nothing
 * else is stored (no request content, no personal or financial data).
 */
export interface UsageStore {
  /** Atomically increments and returns the user's request count for the day and type. */
  incrementRequests(userId: string, day: string, type: ProxyRequestType): Promise<number>;
  /** Total estimated spend for the day across all users, in micro-USD. */
  getSpendMicroUsd(day: string): Promise<number>;
  addSpendMicroUsd(day: string, microUsd: number): Promise<void>;
}

/** Price per million tokens, in USD. */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

export interface LimitsConfig {
  /** Max requests per anonymous user per UTC day, per request type. */
  dailyRequestsPerUser: Record<ProxyRequestType, number>;
  /** Global daily spend cap across all users, in micro-USD. */
  dailySpendCapMicroUsd: number;
  prices: Record<ProxyRequestType, ModelPrice>;
}

export const DEFAULT_LIMITS: LimitsConfig = {
  dailyRequestsPerUser: { categorize: 300, ask: 30 },
  dailySpendCapMicroUsd: 5_000_000,
  prices: {
    categorize: { inputPerMTok: 1, outputPerMTok: 5 },
    ask: { inputPerMTok: 3, outputPerMTok: 15 },
  },
};

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Estimated cost in micro-USD (1 USD per MTok equals 1 micro-USD per token). */
export function estimateCostMicroUsd(
  price: ModelPrice,
  usage: { inputTokens: number; outputTokens: number },
): number {
  return Math.ceil(usage.inputTokens * price.inputPerMTok + usage.outputTokens * price.outputPerMTok);
}

export type LimitDecision = { ok: true } | { ok: false; reason: 'rate_limited' | 'spend_cap_reached' };

/**
 * Checked before every upstream call. The spend cap is checked first so a capped
 * day does not consume user quota. Spend is recorded after the call, so the cap
 * can be overshot by at most the requests in flight when it is reached.
 */
export async function checkLimits(
  store: UsageStore,
  config: LimitsConfig,
  userId: string,
  day: string,
  type: ProxyRequestType,
): Promise<LimitDecision> {
  const spend = await store.getSpendMicroUsd(day);
  if (spend >= config.dailySpendCapMicroUsd) return { ok: false, reason: 'spend_cap_reached' };
  const count = await store.incrementRequests(userId, day, type);
  if (count > config.dailyRequestsPerUser[type]) return { ok: false, reason: 'rate_limited' };
  return { ok: true };
}

/** In-memory store for tests and local experiments. */
export class MemoryUsageStore implements UsageStore {
  readonly requests = new Map<string, number>();
  readonly spend = new Map<string, number>();

  async incrementRequests(userId: string, day: string, type: ProxyRequestType): Promise<number> {
    const key = `${userId}|${day}|${type}`;
    const next = (this.requests.get(key) ?? 0) + 1;
    this.requests.set(key, next);
    return next;
  }

  async getSpendMicroUsd(day: string): Promise<number> {
    return this.spend.get(day) ?? 0;
  }

  async addSpendMicroUsd(day: string, microUsd: number): Promise<void> {
    this.spend.set(day, (this.spend.get(day) ?? 0) + microUsd);
  }
}
