import type { LlmPort, LlmTier } from '@steadily/shared-types';
import type { CategoryId } from '@steadily/taxonomy';
import { categorizeResponseSchema, PROXY_LIMITS } from './schemas.ts';

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
