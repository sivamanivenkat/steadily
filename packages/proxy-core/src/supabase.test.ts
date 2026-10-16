import { describe, expect, it, vi } from 'vitest';
import { readProxyEnv } from './config.ts';
import { createSupabaseUsageStore, createSupabaseUserResolver } from './supabase.ts';

const URL_BASE = 'https://project-ref.supabase.test';

describe('createSupabaseUsageStore', () => {
  it('calls the usage RPCs with the service key and parses results', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const fn = String(url).split('/').pop();
      return new Response(JSON.stringify(fn === 'proxy_get_spend' ? '1500' : 3), { status: 200 });
    });
    const store = createSupabaseUsageStore({
      url: URL_BASE,
      serviceKey: 'sb_secret_placeholder',
      fetch: fetchMock,
    });
    expect(await store.incrementRequests('user-1', '2026-10-15', 'ask')).toBe(3);
    expect(await store.getSpendMicroUsd('2026-10-15')).toBe(1500);
    await store.addSpendMicroUsd('2026-10-15', 12.2);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${URL_BASE}/rest/v1/rpc/proxy_increment_usage`);
    expect(JSON.parse(String(init?.body))).toEqual({
      p_user_id: 'user-1',
      p_day: '2026-10-15',
      p_kind: 'ask',
    });
    const headers = init?.headers as Record<string, string>;
    expect(headers['apikey']).toBe('sb_secret_placeholder');
    expect(headers['authorization']).toBeUndefined();
    expect(JSON.parse(String(fetchMock.mock.calls[2]![1]?.body))).toEqual({
      p_day: '2026-10-15',
      p_micro_usd: 13,
    });
  });

  it('throws on RPC failure so the proxy fails closed', async () => {
    const store = createSupabaseUsageStore({
      url: URL_BASE,
      serviceKey: 'k',
      fetch: async () => new Response('', { status: 500 }),
    });
    await expect(store.getSpendMicroUsd('2026-10-15')).rejects.toThrow();
  });
});

describe('createSupabaseUserResolver', () => {
  const resolver = (respond: () => Response) =>
    createSupabaseUserResolver({ url: URL_BASE, apiKey: 'anon', fetch: async () => respond() });

  it('returns the auth user id for a valid token', async () => {
    const resolve = resolver(
      () => new Response(JSON.stringify({ id: 'anon-1', is_anonymous: true })),
    );
    expect(await resolve('Bearer token')).toBe('anon-1');
  });

  it('returns null for missing or rejected tokens', async () => {
    const resolve = resolver(() => new Response('{}', { status: 401 }));
    expect(await resolve(null)).toBeNull();
    expect(await resolve('Basic abc')).toBeNull();
    expect(await resolve('Bearer token')).toBeNull();
  });
});

describe('readProxyEnv', () => {
  const env: Record<string, string> = {
    ANTHROPIC_API_KEY: 'placeholder',
    SUPABASE_URL: URL_BASE,
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
  };

  it('uses defaults and accepts overrides', () => {
    const config = readProxyEnv((name) => env[name]);
    expect(config.models).toEqual({ categorize: 'claude-haiku-5-5', ask: 'claude-sonnet-5-5' });
    const tuned = readProxyEnv(
      (name) => ({ ...env, PROXY_DAILY_SPEND_CAP_USD: '2.5', PROXY_DAILY_ASK_PER_USER: '5' })[name],
    );
    expect(tuned.limits.dailySpendCapMicroUsd).toBe(2_500_000);
    expect(tuned.limits.dailyRequestsPerUser.ask).toBe(5);
  });

  it('throws without echoing values when a secret is missing', () => {
    expect(() =>
      readProxyEnv((name) => (name === 'ANTHROPIC_API_KEY' ? undefined : env[name])),
    ).toThrow('Missing required environment variable ANTHROPIC_API_KEY');
  });
});
