import { describe, expect, it, vi } from 'vitest';
import { createProxyAskModel, ProxyAskError, type ProxyLlmClientOptions } from './client.ts';

const ENDPOINT = 'https://example.test/functions/v1/claude-proxy';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const tools = [
  {
    name: 'spending_total',
    description: 'Total spending for a period.',
    input_schema: { type: 'object', properties: {} },
  },
];
const stepInput = {
  question: 'How much did I spend this month?',
  tools,
  toolResults: [
    {
      id: 'c1',
      name: 'spending_total',
      input: { period: { kind: 'month', offset: 0 } },
      output: { totalMinor: 29599, currency: 'USD' },
    },
  ],
};

function model(
  respond: () => Response | Promise<Response>,
  overrides: Partial<ProxyLlmClientOptions> = {},
) {
  const fetchMock = vi.fn<typeof fetch>(async () => respond());
  const ask = createProxyAskModel({
    endpoint: ENDPOINT,
    fetch: fetchMock,
    getAccessToken: async () => 'anon-token',
    isCloudEnabled: () => true,
    ...overrides,
  });
  return { ask, fetchMock };
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProxyAskError);
    return (error as ProxyAskError).code;
  }
  throw new Error('expected a ProxyAskError');
}

describe('createProxyAskModel', () => {
  it('posts exactly the ask request and returns an answer', async () => {
    const { ask, fetchMock } = model(() =>
      json({ type: 'ask', kind: 'answer', text: 'About $296.' }),
    );
    expect(await ask.step(stepInput)).toEqual({ kind: 'answer', text: 'About $296.' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(ENDPOINT);
    expect(JSON.parse(String(init?.body))).toEqual({ type: 'ask', ...stepInput });
    expect((init?.headers as Record<string, string>)['authorization']).toBe('Bearer anon-token');
    expect(ask.source).toBe('cloud_llm');
  });

  it('returns tool calls', async () => {
    const calls = [
      { id: 'a1', name: 'spending_total', input: { period: { kind: 'month', offset: 0 } } },
    ];
    const { ask } = model(() => json({ type: 'ask', kind: 'tool_calls', calls }));
    expect(await ask.step({ ...stepInput, toolResults: [] })).toEqual({
      kind: 'tool_calls',
      calls,
    });
  });

  it('sends nothing without opt-in', async () => {
    const { ask, fetchMock } = model(() => json({}), { isCloudEnabled: () => false });
    expect(await codeOf(ask.step(stepInput))).toBe('cloud_disabled');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing without a session', async () => {
    const { ask, fetchMock } = model(() => json({}), { getAccessToken: async () => null });
    expect(await codeOf(ask.step(stepInput))).toBe('no_session');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses requests that break the contract before sending', async () => {
    const { ask, fetchMock } = model(() => json({}));
    const big = {
      ...stepInput,
      toolResults: [{ ...stepInput.toolResults[0]!, output: 'x'.repeat(17_000) }],
    };
    expect(await codeOf(ask.step(big))).toBe('invalid_request');
    expect(await codeOf(ask.step({ ...stepInput, question: ' ' }))).toBe('invalid_request');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['http_error', () => json({ error: 'rate_limited' }, 429)],
    ['http_error', () => json({ error: 'upstream_error' }, 502)],
    ['invalid_response', () => json({ type: 'ask', kind: 'answer', text: '' })],
    ['invalid_response', () => json({ type: 'ask', kind: 'other' })],
    ['invalid_response', () => json({ type: 'categorize', result: null })],
    ['invalid_response', () => json({ type: 'ask', kind: 'tool_calls', calls: [] })],
    ['invalid_response', () => new Response('oops', { status: 200 })],
    [
      'network',
      () => {
        throw new TypeError('offline');
      },
    ],
  ])('throws %s', async (expected, respond) => {
    const { ask } = model(respond as () => Response);
    expect(await codeOf(ask.step(stepInput))).toBe(expected);
  });

  it('error messages carry no request or response text', async () => {
    const { ask } = model(() => json({ error: 'x', echo: stepInput.question }, 500));
    const error = (await ask.step(stepInput).catch((e: unknown) => e)) as ProxyAskError;
    expect(error.message).toBe('claude-proxy ask failed: http_error');
    expect(error.status).toBe(500);
  });

  it('times out', async () => {
    const hanging: typeof fetch = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const { ask } = model(() => json({}), { fetch: hanging, timeoutMs: 5 });
    expect(await codeOf(ask.step(stepInput))).toBe('timeout');
  });
});
