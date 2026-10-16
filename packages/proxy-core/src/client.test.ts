import { describe, expect, it, vi } from 'vitest';
import { createProxyLlmClient, type ProxyLlmClientOptions } from './client.ts';

const ENDPOINT = 'https://example.test/functions/v1/claude-proxy';
const input = {
  merchant: 'SYNTH TACO STAND 0002',
  amountMinor: 1250,
  allowed: ['food.dining', 'food.groceries', 'other.general'] as const,
};

function client(
  respond: () => Response | Promise<Response>,
  overrides: Partial<ProxyLlmClientOptions> = {},
) {
  const fetchMock = vi.fn<typeof fetch>(async () => respond());
  const port = createProxyLlmClient({
    endpoint: ENDPOINT,
    fetch: fetchMock,
    getAccessToken: async () => 'anon-token',
    isCloudEnabled: () => true,
    ...overrides,
  });
  return { port, fetchMock };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createProxyLlmClient', () => {
  it('sends only type, merchant, amount and allowed ids', async () => {
    const { port, fetchMock } = client(() =>
      json({ type: 'categorize', result: { categoryId: 'food.dining', confidence: 0.7 } }),
    );
    expect(await port.chooseCategory(input)).toEqual({
      categoryId: 'food.dining',
      confidence: 0.7,
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(ENDPOINT);
    expect(JSON.parse(String(init?.body))).toEqual({
      type: 'categorize',
      merchant: input.merchant,
      amountMinor: 1250,
      allowed: [...input.allowed],
    });
    expect((init?.headers as Record<string, string>)['authorization']).toBe('Bearer anon-token');
  });

  it('does nothing without opt-in', async () => {
    const { port, fetchMock } = client(() => json({}), { isCloudEnabled: () => false });
    expect(await port.tier()).toBe('none');
    expect(await port.chooseCategory(input)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports the cloud tier when opted in', async () => {
    expect(await client(() => json({})).port.tier()).toBe('cloud');
  });

  it.each([
    ['HTTP 429', () => json({ error: 'rate_limited' }, 429)],
    ['HTTP 503', () => json({ error: 'spend_cap_reached' }, 503)],
    ['null result', () => json({ type: 'categorize', result: null })],
    [
      'id outside allowed',
      () => json({ type: 'categorize', result: { categoryId: 'travel.general', confidence: 0.9 } }),
    ],
    [
      'invalid id',
      () => json({ type: 'categorize', result: { categoryId: 'nope', confidence: 0.9 } }),
    ],
    [
      'bad confidence',
      () => json({ type: 'categorize', result: { categoryId: 'food.dining', confidence: 3 } }),
    ],
    ['non-JSON', () => new Response('oops', { status: 200 })],
    [
      'network error',
      () => {
        throw new TypeError('offline');
      },
    ],
  ])('returns null on %s', async (_name, respond) => {
    expect(await client(respond).port.chooseCategory(input)).toBeNull();
  });

  it('returns null without a session token', async () => {
    const { port, fetchMock } = client(() => json({}), { getAccessToken: async () => null });
    expect(await port.chooseCategory(input)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('truncates long merchant text and refuses oversized allowed lists', async () => {
    const { port, fetchMock } = client(() => json({ type: 'categorize', result: null }));
    await port.chooseCategory({ ...input, merchant: 'M'.repeat(500) });
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)).merchant).toHaveLength(200);
    const many = Array.from({ length: 41 }, (_, i) => `custom.c${i}` as const);
    expect(await port.chooseCategory({ ...input, allowed: many })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('times out and returns null', async () => {
    const hanging: typeof fetch = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const { port } = client(() => json({}), { fetch: hanging, timeoutMs: 5 });
    expect(await port.chooseCategory(input)).toBeNull();
  });
});
