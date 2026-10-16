import { z } from 'zod';
import { isCategoryId, type CategoryId } from '@steadily/taxonomy';

/**
 * Wire contract of the claude-proxy edge function (D-011, D-018).
 * Exactly two request types exist; anything else is rejected.
 */
export const PROXY_LIMITS = {
  /** Whole request body, checked before JSON parsing. */
  maxBodyBytes: 32 * 1024,
  merchantMaxChars: 200,
  maxAllowedIds: 40,
  questionMaxChars: 500,
  /** Serialized size of `toolResults`. */
  toolResultsMaxBytes: 16 * 1024,
  /** Serialized size of `tools`. */
  toolsMaxBytes: 12 * 1024,
  maxTools: 12,
  maxToolResults: 24,
  toolDescriptionMaxChars: 1024,
  /** Bound for `amountMinor` (cents): ten billion dollars either way. */
  maxAbsAmountMinor: 1_000_000_000_000,
} as const;

const encoder = new TextEncoder();

export function jsonByteLength(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

export const categoryIdSchema = z.custom<CategoryId>(
  (value) => typeof value === 'string' && value.length <= 64 && isCategoryId(value),
  { message: 'invalid category id' },
);

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);

const jsonObject = z.record(z.string(), z.json());

export const categorizeRequestSchema = z.strictObject({
  type: z.literal('categorize'),
  merchant: z.string().trim().min(1).max(PROXY_LIMITS.merchantMaxChars),
  amountMinor: z.int().min(-PROXY_LIMITS.maxAbsAmountMinor).max(PROXY_LIMITS.maxAbsAmountMinor),
  allowed: z
    .array(categoryIdSchema)
    .min(1)
    .max(PROXY_LIMITS.maxAllowedIds)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'duplicate category ids' }),
});

/** A tool the on-device agent can run, described in Anthropic tool format. */
export const toolDefinitionSchema = z.strictObject({
  name: identifier,
  description: z.string().min(1).max(PROXY_LIMITS.toolDescriptionMaxChars),
  input_schema: jsonObject.refine((schema) => schema['type'] === 'object', {
    message: 'input_schema must be a JSON schema of type object',
  }),
});

/** A tool call the model asked for earlier, already executed on the device. */
export const toolResultSchema = z.strictObject({
  id: identifier,
  name: identifier,
  input: jsonObject,
  /** Aggregates only (totals, counts, category sums), never raw transactions. */
  output: z.json(),
});

export const askRequestSchema = z
  .strictObject({
    type: z.literal('ask'),
    question: z.string().trim().min(1).max(PROXY_LIMITS.questionMaxChars),
    tools: z.array(toolDefinitionSchema).max(PROXY_LIMITS.maxTools),
    toolResults: z.array(toolResultSchema).max(PROXY_LIMITS.maxToolResults),
  })
  .superRefine((req, ctx) => {
    if (jsonByteLength(req.tools) > PROXY_LIMITS.toolsMaxBytes) {
      ctx.addIssue({ code: 'custom', path: ['tools'], message: 'tools too large' });
    }
    if (jsonByteLength(req.toolResults) > PROXY_LIMITS.toolResultsMaxBytes) {
      ctx.addIssue({ code: 'custom', path: ['toolResults'], message: 'toolResults too large' });
    }
    const names = new Set(req.tools.map((t) => t.name));
    if (names.size !== req.tools.length) {
      ctx.addIssue({ code: 'custom', path: ['tools'], message: 'duplicate tool names' });
    }
    const ids = new Set(req.toolResults.map((r) => r.id));
    if (ids.size !== req.toolResults.length) {
      ctx.addIssue({ code: 'custom', path: ['toolResults'], message: 'duplicate tool call ids' });
    }
    if (req.toolResults.some((r) => !names.has(r.name))) {
      ctx.addIssue({ code: 'custom', path: ['toolResults'], message: 'unknown tool name' });
    }
  });

export const proxyRequestSchema = z.discriminatedUnion('type', [
  categorizeRequestSchema,
  askRequestSchema,
]);

export type CategorizeRequest = z.infer<typeof categorizeRequestSchema>;
export type AskRequest = z.infer<typeof askRequestSchema>;
export type ProxyRequest = z.infer<typeof proxyRequestSchema>;
export type ProxyRequestType = ProxyRequest['type'];
export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;
export type ToolResult = z.infer<typeof toolResultSchema>;

export interface CategorizeResponse {
  type: 'categorize';
  /** Always one of the request's `allowed` ids, or null when the model gave no valid answer. */
  result: { categoryId: CategoryId; confidence: number } | null;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type AskResponse =
  | { type: 'ask'; kind: 'answer'; text: string }
  | { type: 'ask'; kind: 'tool_calls'; calls: ToolCall[] };

export type ProxyResponse = CategorizeResponse | AskResponse;

export type ProxyErrorCode =
  | 'method_not_allowed'
  | 'unauthorized'
  | 'payload_too_large'
  | 'invalid_request'
  | 'rate_limited'
  | 'spend_cap_reached'
  | 'upstream_error'
  | 'server_error';

export interface ProxyErrorBody {
  error: ProxyErrorCode;
}

export const categorizeResponseSchema = z.strictObject({
  type: z.literal('categorize'),
  result: z
    .strictObject({
      categoryId: categoryIdSchema,
      confidence: z.number().min(0).max(1),
    })
    .nullable(),
});
