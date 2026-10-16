import type { UsageStore } from './limits.ts';
import type { ProxyRequestType } from './schemas.ts';

/**
 * Supabase adapters for the edge function. Plain `fetch` against PostgREST and
 * GoTrue so the function needs no extra dependencies and tests can inject fetch.
 */
export interface SupabaseConfig {
  url: string;
  /** Service role / secret key: only the edge function can call the usage RPCs. */
  serviceKey: string;
  fetch: typeof fetch;
}

function serviceHeaders(key: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: key, 'content-type': 'application/json' };
  // Legacy service_role keys are JWTs and also go in Authorization; new secret keys do not.
  if (key.startsWith('eyJ')) headers['authorization'] = `Bearer ${key}`;
  return headers;
}

async function rpc(config: SupabaseConfig, fn: string, args: Record<string, unknown>) {
  const res = await config.fetch(`${config.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: serviceHeaders(config.serviceKey),
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`rpc ${fn} failed with status ${res.status}`);
  return (await res.json()) as unknown;
}

function toNumber(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('unexpected rpc result');
  return n;
}

export function createSupabaseUsageStore(config: SupabaseConfig): UsageStore {
  return {
    async incrementRequests(userId: string, day: string, type: ProxyRequestType) {
      return toNumber(
        await rpc(config, 'proxy_increment_usage', { p_user_id: userId, p_day: day, p_kind: type }),
      );
    },
    async getSpendMicroUsd(day: string) {
      return toNumber(await rpc(config, 'proxy_get_spend', { p_day: day }));
    },
    async addSpendMicroUsd(day: string, microUsd: number) {
      await rpc(config, 'proxy_add_spend', { p_day: day, p_micro_usd: Math.ceil(microUsd) });
    },
  };
}

/**
 * Resolves the caller's (anonymous) auth user id from the Authorization header by
 * asking Supabase Auth. Returns null for missing, invalid or expired tokens.
 */
export function createSupabaseUserResolver(config: {
  url: string;
  /** Publishable / anon key. */
  apiKey: string;
  fetch: typeof fetch;
}): (authorization: string | null) => Promise<string | null> {
  return async (authorization) => {
    const match = authorization?.match(/^Bearer\s+(\S+)$/i);
    if (!match) return null;
    try {
      const res = await config.fetch(`${config.url}/auth/v1/user`, {
        headers: { apikey: config.apiKey, authorization: `Bearer ${match[1]}` },
      });
      if (!res.ok) return null;
      const user = (await res.json()) as { id?: unknown };
      return typeof user.id === 'string' && user.id.length > 0 ? user.id : null;
    } catch {
      return null;
    }
  };
}
