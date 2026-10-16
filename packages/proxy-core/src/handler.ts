import {
  buildAskRequest,
  buildCategorizeRequest,
  callMessages,
  DEFAULT_MODELS,
  mapAskResponse,
  mapCategorizeResponse,
  type MessagesRequest,
  type MessagesResponse,
} from './anthropic.ts';
import {
  checkLimits,
  DEFAULT_LIMITS,
  estimateCostMicroUsd,
  utcDay,
  type LimitsConfig,
  type UsageStore,
} from './limits.ts';
import type { ProxyLogEntry, ProxyLogger } from './logger.ts';
import {
  PROXY_LIMITS,
  proxyRequestSchema,
  type ProxyErrorCode,
  type ProxyRequestType,
  type ProxyResponse,
} from './schemas.ts';

export interface ProxyDeps {
  /** Anthropic API key from Supabase secrets. Never shipped in the app. */
  apiKey: string;
  fetch: typeof fetch;
  store: UsageStore;
  /** Maps the Authorization header to an anonymous auth user id, or null. */
  resolveUser: (authorization: string | null) => Promise<string | null>;
  logger: ProxyLogger;
  now?: () => Date;
  /** Monotonic-ish milliseconds for latency. */
  clock?: () => number;
  limits?: LimitsConfig;
  models?: { categorize: string; ask: string };
}

export interface ProxyHttpRequest {
  method: string;
  authorization: string | null;
  /** Raw body, or null when it exceeded `PROXY_LIMITS.maxBodyBytes`. */
  bodyText: string | null;
}

export interface ProxyHttpResponse {
  status: number;
  body: ProxyResponse | { error: ProxyErrorCode };
}

const STATUS: Record<ProxyErrorCode, number> = {
  method_not_allowed: 405,
  unauthorized: 401,
  payload_too_large: 413,
  invalid_request: 400,
  rate_limited: 429,
  spend_cap_reached: 503,
  upstream_error: 502,
  server_error: 500,
};

function fail(error: ProxyErrorCode): ProxyHttpResponse {
  return { status: STATUS[error], body: { error } };
}

/** Transport-independent request handling; every outcome is logged as status/latency/tokens only. */
export async function handleProxyRequest(
  req: ProxyHttpRequest,
  deps: ProxyDeps,
): Promise<ProxyHttpResponse> {
  const clock = deps.clock ?? (() => Date.now());
  const started = clock();
  const log: ProxyLogEntry = { requestType: 'unknown', status: 0, latencyMs: 0 };
  let response: ProxyHttpResponse;
  try {
    response = await process(req, deps, log);
  } catch {
    response = fail('server_error');
  }
  log.status = response.status;
  log.latencyMs = clock() - started;
  try {
    deps.logger.record(log);
  } catch {
    // Logging must never break a request.
  }
  return response;
}

async function process(
  req: ProxyHttpRequest,
  deps: ProxyDeps,
  log: ProxyLogEntry,
): Promise<ProxyHttpResponse> {
  if (req.method !== 'POST') return fail('method_not_allowed');

  const userId = await deps.resolveUser(req.authorization);
  if (!userId) return fail('unauthorized');

  if (req.bodyText === null) return fail('payload_too_large');
  if (new TextEncoder().encode(req.bodyText).length > PROXY_LIMITS.maxBodyBytes) {
    return fail('payload_too_large');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(req.bodyText);
  } catch {
    return fail('invalid_request');
  }
  const parsed = proxyRequestSchema.safeParse(raw);
  if (!parsed.success) return fail('invalid_request');
  const request = parsed.data;
  const type: ProxyRequestType = request.type;
  log.requestType = type;

  const limits = deps.limits ?? DEFAULT_LIMITS;
  const day = utcDay((deps.now ?? (() => new Date()))());
  const decision = await checkLimits(deps.store, limits, userId, day, type);
  if (!decision.ok) return fail(decision.reason);

  const models = deps.models ?? DEFAULT_MODELS;
  const body: MessagesRequest =
    request.type === 'categorize'
      ? buildCategorizeRequest(request, models.categorize)
      : buildAskRequest(request, models.ask);

  let upstream: MessagesResponse;
  try {
    upstream = await callMessages(deps.fetch, deps.apiKey, body);
  } catch {
    return fail('upstream_error');
  }

  if (upstream.usage) {
    const usage = {
      inputTokens: upstream.usage.input_tokens,
      outputTokens: upstream.usage.output_tokens,
    };
    log.inputTokens = usage.inputTokens;
    log.outputTokens = usage.outputTokens;
    try {
      await deps.store.addSpendMicroUsd(day, estimateCostMicroUsd(limits.prices[type], usage));
    } catch {
      // The answer is already paid for; a failed counter update should not drop it.
    }
  }

  if (request.type === 'categorize') {
    return { status: 200, body: mapCategorizeResponse(upstream, request.allowed) };
  }
  const answer = mapAskResponse(upstream, request);
  return answer ? { status: 200, body: answer } : fail('upstream_error');
}

/** Reads at most `limit` bytes; returns null if the body is larger. */
export async function readBodyCapped(req: Request, limit: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Fetch-style handler for `Deno.serve`. */
export function createProxyHandler(deps: ProxyDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    let bodyText: string | null = '';
    if (req.method === 'POST') {
      bodyText = await readBodyCapped(req, PROXY_LIMITS.maxBodyBytes).catch(() => null);
    }
    const result = await handleProxyRequest(
      { method: req.method, authorization: req.headers.get('authorization'), bodyText },
      deps,
    );
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  };
}
