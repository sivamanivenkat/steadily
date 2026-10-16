import { DEFAULT_MODELS } from './anthropic.ts';
import { DEFAULT_LIMITS, type LimitsConfig } from './limits.ts';

export interface ProxyEnvConfig {
  anthropicApiKey: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceKey: string;
  models: { categorize: string; ask: string };
  limits: LimitsConfig;
}

function positiveNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Reads secrets and optional overrides. Throws (without values) if a secret is missing. */
export function readProxyEnv(get: (name: string) => string | undefined): ProxyEnvConfig {
  const required = (name: string): string => {
    const value = get(name);
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
  };
  return {
    anthropicApiKey: required('ANTHROPIC_API_KEY'),
    supabaseUrl: required('SUPABASE_URL'),
    supabaseAnonKey: required('SUPABASE_ANON_KEY'),
    supabaseServiceKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    models: {
      categorize: get('CLAUDE_CATEGORIZE_MODEL') || DEFAULT_MODELS.categorize,
      ask: get('CLAUDE_ASK_MODEL') || DEFAULT_MODELS.ask,
    },
    limits: {
      ...DEFAULT_LIMITS,
      dailyRequestsPerUser: {
        categorize: positiveNumber(
          get('PROXY_DAILY_CATEGORIZE_PER_USER'),
          DEFAULT_LIMITS.dailyRequestsPerUser.categorize,
        ),
        ask: positiveNumber(get('PROXY_DAILY_ASK_PER_USER'), DEFAULT_LIMITS.dailyRequestsPerUser.ask),
      },
      dailySpendCapMicroUsd: Math.round(
        positiveNumber(
          get('PROXY_DAILY_SPEND_CAP_USD'),
          DEFAULT_LIMITS.dailySpendCapMicroUsd / 1_000_000,
        ) * 1_000_000,
      ),
    },
  };
}
