import { z } from 'zod';
import type { LlmPort, LlmTier } from '@steadily/shared-types';
import type { CategoryId } from '@steadily/taxonomy';
import { askRequestSchema, categorizeResponseSchema, PROXY_LIMITS } from './schemas.ts';

export interface ProxyLlmClientOptions {
  /** Full URL of the deployed function, e.g. `https://<ref>.supabase.co/functions/v1/claude-proxy`. */
  endpoint: string;
  fetch: typeof fetch;
  /** Access token of the anonymous Supabase session, or null if there is none. */
  getAccessToken: () => Promise<string | null>;
  /** The user's cloud-AI opt-in (D-011). Nothing is sent unless this is true. */
  isCloudEnabled: () => boolean | Promise<boolean>;
  timeoutMs?: number;
}

/**
 * Cloud `LlmPort` backed by the claude-proxy. Sends only merchant, amount and the
 * allowed category ids. Any failure (offline, limits, bad output) yields null so the
 * categorizer falls back to rules or the review queue.
 */
export function createProxyLlmClient(options: ProxyLlmClientOptions): LlmPort {
  const timeoutMs = options.timeoutMs ?? 10_000;

  return {
    async tier(): Promise<LlmTier> {
      try {
        return (await options.isCloudEnabled()) ? 'cloud' : 'none';
      } catch {
        return 'none';
      }
    },

    async chooseCategory(input: {
      merchant: string;
      amountMinor: number;
      allowed: readonly CategoryId[];
    }): Promise<{ categoryId: CategoryId; confidence: number } | null> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        if (!(await options.isCloudEnabled())) return null;
        const merchant = input.merchant.trim().slice(0, PROXY_LIMITS.merchantMaxChars);
        const allowed = [...new Set(input.allowed)];
        if (!merchant || allowed.length === 0 || allowed.length > PROXY_LIMITS.maxAllowedIds) {
          return null;
        }
        if (!Number.isSafeInteger(input.amountMinor)) return null;
        const token = await options.getAccessToken();
        if (!token) return null;

        const res = await options.fetch(options.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({
            type: 'categorize',
            merchant,
            amountMinor: input.amountMinor,
            allowed,
          }),
          signal: controller.signal,
        });
        if (!res.ok) return null;
        const parsed = categorizeResponseSchema.safeParse(await res.json());
        if (!parsed.success || !parsed.data.result) return null;
        const { categoryId, confidence } = parsed.data.result;
        return allowed.includes(categoryId) ? { categoryId, confidence } : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Ask your money
// ---------------------------------------------------------------------------

// These mirror AskModel in @steadily/agent-core structurally. They are defined
// here so proxy-core does not depend on agent-core.
export interface AskModelToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
export interface AskModelToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface AskModelToolResult {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output: unknown;
}
export type AskModelStep =
  { kind: 'tool_calls'; calls: AskModelToolCall[] } | { kind: 'answer'; text: string };

export interface ProxyAskModel {
  readonly source: 'cloud_llm';
  step(input: {
    question: string;
    tools: AskModelToolDefinition[];
    toolResults: AskModelToolResult[];
  }): Promise<AskModelStep>;
}

export type ProxyAskErrorCode =
  | 'cloud_disabled'
  | 'no_session'
  | 'invalid_request'
  | 'http_error'
  | 'invalid_response'
  | 'timeout'
  | 'network';

/** Thrown by the ask model on any failure. Never carries request or response text. */
export class ProxyAskError extends Error {
  readonly code: ProxyAskErrorCode;
  readonly status: number | undefined;
  constructor(code: ProxyAskErrorCode, status?: number) {
    super(`claude-proxy ask failed: ${code}`);
    this.name = 'ProxyAskError';
    this.code = code;
    this.status = status;
  }
}

const askResponseSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    type: z.literal('ask'),
    kind: z.literal('answer'),
    text: z.string().trim().min(1).max(8000),
  }),
  z.strictObject({
    type: z.literal('ask'),
    kind: z.literal('tool_calls'),
    calls: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
          name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
          input: z.record(z.string(), z.json()),
        }),
      )
      .min(1)
      .max(8),
  }),
]);

/**
 * Cloud model for Ask-your-money. One `step` is one POST of the `ask` request. The
 * caller (agent-core `answerQuestion`) runs the tools on the device and passes
 * only their aggregate results back. Nothing is sent unless the user opted in.
 * Throws `ProxyAskError` on any failure so the caller can fall back to rules.
 */
export function createProxyAskModel(options: ProxyLlmClientOptions): ProxyAskModel {
  const timeoutMs = options.timeoutMs ?? 20_000;

  return {
    source: 'cloud_llm',
    async step(input) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        if (!(await options.isCloudEnabled())) throw new ProxyAskError('cloud_disabled');
        const request = askRequestSchema.safeParse({
          type: 'ask',
          question: input.question,
          tools: input.tools,
          toolResults: input.toolResults,
        });
        if (!request.success) throw new ProxyAskError('invalid_request');
        const token = await options.getAccessToken();
        if (!token) throw new ProxyAskError('no_session');

        let res: Response;
        try {
          res = await options.fetch(options.endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify(request.data),
            signal: controller.signal,
          });
        } catch {
          throw new ProxyAskError(controller.signal.aborted ? 'timeout' : 'network');
        }
        if (!res.ok) throw new ProxyAskError('http_error', res.status);
        let body: unknown;
        try {
          body = await res.json();
        } catch {
          throw new ProxyAskError(controller.signal.aborted ? 'timeout' : 'invalid_response');
        }
        const parsed = askResponseSchema.safeParse(body);
        if (!parsed.success) throw new ProxyAskError('invalid_response');
        return parsed.data.kind === 'answer'
          ? { kind: 'answer', text: parsed.data.text }
          : { kind: 'tool_calls', calls: parsed.data.calls };
      } catch (error) {
        if (error instanceof ProxyAskError) throw error;
        throw new ProxyAskError('network');
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
