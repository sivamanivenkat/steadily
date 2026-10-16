import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProxyHandler, handleProxyRequest, type ProxyDeps } from './handler.ts';
import { DEFAULT_LIMITS, MemoryUsageStore, type LimitsConfig } from './limits.ts';
import { createConsoleProxyLogger, type ProxyLogEntry } from './logger.ts';
import { PROXY_LIMITS } from './schemas.ts';
import { anthropicResponse, askBody, categorizeBody, toolUse } from './test-helpers.ts';

const USER = '00000000-0000-4000-8000-000000000001';
const FAKE_KEY = 'test-key-not-real';

function setup(
  options: { limits?: LimitsConfig; upstream?: () => Response | Promise<Response> } = {},
) {
  const store = new MemoryUsageStore();
  const entries: ProxyLogEntry[] = [];
  const fetchMock = vi.fn<typeof fetch>(async () =>
    options.upstream
      ? options.upstream()
      : anthropicResponse([toolUse({ categoryId: 'food.coffee', confidence: 0.8 })]),
  );
  const deps: ProxyDeps = {
    apiKey: FAKE_KEY,
    fetch: fetchMock,
    store,
    resolveUser: async (auth) => (auth === 'Bearer anon-token' ? USER : null),
    logger: { record: (e) => entries.push(e) },
    now: () => new Date('2026-10-15T12:00:00Z'),
    ...(options.limits ? { limits: options.limits } : {}),
  };
  const call = (body: unknown, init: { method?: string; authorization?: string | null } = {}) =>
    handleProxyRequest(
      {
        method: init.method ?? 'POST',
        authorization: init.authorization === undefined ? 'Bearer anon-token' : init.authorization,
        bodyText: typeof body === 'string' ? body : JSON.stringify(body),
      },
      deps,
    );
  return { store, entries, fetchMock, deps, call };
}

afterEach(() => vi.restoreAllMocks());

describe('handleProxyRequest', () => {
  it('categorizes through the Messages API with the injected key and fetch', async () => {
    const { call, fetchMock } = setup();
    const res = await call(categorizeBody());
    expect(res).toEqual({
      status: 200,
      body: { type: 'categorize', result: { categoryId: 'food.coffee', confidence: 0.8 } },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(FAKE_KEY);
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(JSON.parse(String(init?.body)).model).toBe('claude-haiku-5-5');
  });

  it('returns a null result when the model picks an id outside allowed', async () => {
    const { call } = setup({
      upstream: () => anthropicResponse([toolUse({ categoryId: 'travel.general', confidence: 1 })]),
    });
    expect((await call(categorizeBody())).body).toEqual({ type: 'categorize', result: null });
  });

  it('runs an ask step and returns tool calls for the device', async () => {
    const { call, fetchMock } = setup({
      upstream: () =>
        anthropicResponse(
          [toolUse({ categoryId: 'food.coffee', period: 'this_month' }, 'category_total', 'tu_1')],
          { input_tokens: 400, output_tokens: 50 },
          'tool_use',
        ),
    });
    const res = await call(askBody());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ type: 'ask', kind: 'tool_calls' });
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)).model).toBe('claude-sonnet-5-5');
  });

  it.each([
    ['GET', { method: 'GET' }, 405],
    ['no auth', { authorization: null }, 401],
    ['bad token', { authorization: 'Bearer nope' }, 401],
  ])('rejects %s', async (_name, init, status) => {
    const { call, fetchMock } = setup();
    expect((await call(categorizeBody(), init)).status).toBe(status);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{"type":'],
    ['unknown type', { type: 'complete', prompt: 'hi' }],
    ['invalid category', { ...categorizeBody(), allowed: ['nope'] }],
  ])('rejects %s with 400 without calling upstream', async (_name, body) => {
    const { call, fetchMock } = setup();
    expect(await call(body)).toEqual({ status: 400, body: { error: 'invalid_request' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects bodies over the byte cap with 413', async () => {
    const { call, deps } = setup();
    const huge = JSON.stringify({ ...askBody(), pad: 'x'.repeat(PROXY_LIMITS.maxBodyBytes) });
    expect((await call(huge)).status).toBe(413);
    const res = await handleProxyRequest(
      { method: 'POST', authorization: 'Bearer anon-token', bodyText: null },
      deps,
    );
    expect(res.status).toBe(413);
  });

  it('maps upstream failures to 502 without leaking details', async () => {
    const { call } = setup({
      upstream: () => new Response('{"error":{"message":"secret detail"}}', { status: 529 }),
    });
    expect(await call(categorizeBody())).toEqual({
      status: 502,
      body: { error: 'upstream_error' },
    });
  });

  it('maps a thrown fetch to 502', async () => {
    const { call } = setup({
      upstream: () => {
        throw new Error('network down');
      },
    });
    expect((await call(categorizeBody())).status).toBe(502);
  });
});

describe('rate limit and spend cap', () => {
  const tight: LimitsConfig = {
    ...DEFAULT_LIMITS,
    dailyRequestsPerUser: { categorize: 2, ask: 1 },
  };

  it('allows N requests per user per day and type, then 429', async () => {
    const { call, fetchMock } = setup({ limits: tight });
    expect((await call(categorizeBody())).status).toBe(200);
    expect((await call(categorizeBody())).status).toBe(200);
    expect(await call(categorizeBody())).toEqual({ status: 429, body: { error: 'rate_limited' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Separate budget per request type.
    expect((await call(askBody())).status).not.toBe(429);
  });

  it('keys the limit by user and UTC day', async () => {
    const { store, deps } = setup({ limits: tight });
    await store.incrementRequests(USER, '2026-10-15', 'categorize');
    await store.incrementRequests(USER, '2026-10-15', 'categorize');
    const request = {
      method: 'POST',
      authorization: 'Bearer anon-token',
      bodyText: JSON.stringify(categorizeBody()),
    };
    expect((await handleProxyRequest(request, deps)).status).toBe(429);
    const nextDay = { ...deps, now: () => new Date('2026-10-16T00:00:01Z') };
    expect((await handleProxyRequest(request, nextDay)).status).toBe(200);
    const otherUser = { ...deps, resolveUser: async () => 'another-anon-user' };
    expect((await handleProxyRequest(request, otherUser)).status).toBe(200);
  });

  it('records estimated spend from token usage', async () => {
    const { call, store } = setup({
      upstream: () =>
        anthropicResponse([toolUse({ categoryId: 'food.coffee', confidence: 1 })], {
          input_tokens: 1000,
          output_tokens: 100,
        }),
    });
    await call(categorizeBody());
    // Haiku defaults: 1 + 5 micro-USD per token.
    expect(await store.getSpendMicroUsd('2026-10-15')).toBe(1000 * 1 + 100 * 5);
  });

  it('returns 503 once the global daily spend cap is reached, for every user', async () => {
    const { call, store, fetchMock } = setup({
      limits: { ...DEFAULT_LIMITS, dailySpendCapMicroUsd: 1000 },
    });
    await store.addSpendMicroUsd('2026-10-15', 1000);
    expect(await call(categorizeBody())).toEqual({
      status: 503,
      body: { error: 'spend_cap_reached' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    // A capped day does not consume user quota.
    expect(store.requests.size).toBe(0);
  });

  it('fails closed when the usage store is unavailable', async () => {
    const { call, deps, fetchMock } = setup();
    deps.store.getSpendMicroUsd = async () => {
      throw new Error('db down');
    };
    expect((await call(categorizeBody())).status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('logging', () => {
  const SECRET_MERCHANT = 'ZZSENTINELMERCHANTQX';
  const SECRET_QUESTION = 'ZZSENTINELQUESTIONQX';
  const SECRET_OUTPUT = 'ZZSENTINELTOOLOUTPUTQX';
  const SECRET_ANSWER = 'ZZSENTINELANSWERQX';

  it('never passes request or response text to the logger or console', async () => {
    const consoleLines: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        consoleLines.push(
          args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
        );
      });
    }
    const written: string[] = [];
    const { deps } = setup({
      upstream: () => anthropicResponse([{ type: 'text', text: `${SECRET_ANSWER} $42` }]),
    });
    const spyLogger = createConsoleProxyLogger((line) => written.push(line));
    const handler = createProxyHandler({ ...deps, logger: spyLogger });

    const post = (body: unknown, auth = 'Bearer anon-token') =>
      handler(
        new Request('https://example.test/functions/v1/claude-proxy', {
          method: 'POST',
          headers: { authorization: auth, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );

    const ok = await post(
      askBody({
        question: `${SECRET_QUESTION} coffee?`,
        toolResults: [
          { id: 't1', name: 'category_total', input: {}, output: { note: SECRET_OUTPUT } },
        ],
      }),
    );
    expect(await ok.text()).toContain(SECRET_ANSWER);
    await post(categorizeBody({ merchant: SECRET_MERCHANT }));
    await post({ ...categorizeBody({ merchant: SECRET_MERCHANT }), extra: SECRET_MERCHANT });
    await post(categorizeBody({ merchant: SECRET_MERCHANT }), 'Bearer wrong');

    expect(written).toHaveLength(4);
    const everything = [...written, ...consoleLines].join('\n');
    for (const secret of [SECRET_MERCHANT, SECRET_QUESTION, SECRET_OUTPUT, SECRET_ANSWER]) {
      expect(everything).not.toContain(secret);
    }
    expect(everything).not.toContain(USER);
    expect(everything).not.toContain(FAKE_KEY);
    for (const line of written) {
      const keys = Object.keys(JSON.parse(line));
      for (const key of keys) {
        expect([
          'event',
          'requestType',
          'status',
          'latencyMs',
          'inputTokens',
          'outputTokens',
        ]).toContain(key);
      }
    }
    expect(JSON.parse(written[0]!)).toMatchObject({
      requestType: 'ask',
      status: 200,
      inputTokens: 120,
      outputTokens: 30,
    });
  });

  it('logs exactly one entry per request with status and latency', async () => {
    let t = 1000;
    const { deps, entries } = setup();
    const res = await handleProxyRequest(
      { method: 'POST', authorization: 'Bearer anon-token', bodyText: '[]' },
      { ...deps, clock: () => (t += 7) },
    );
    expect(res.status).toBe(400);
    expect(entries).toEqual([{ requestType: 'unknown', status: 400, latencyMs: 7 }]);
  });

  it('drops unexpected fields even if a caller passes them', () => {
    const lines: string[] = [];
    const logger = createConsoleProxyLogger((l) => lines.push(l));
    logger.record({
      requestType: 'categorize',
      status: 200,
      latencyMs: 12,
      merchant: 'leak',
    } as ProxyLogEntry);
    expect(lines[0]).not.toContain('leak');
  });
});
