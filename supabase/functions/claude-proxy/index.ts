// claude-proxy: the only path from the app to Claude (D-011, D-018).
// Thin Deno entry; all logic lives in packages/proxy-core and is tested under Node.
import {
  createConsoleProxyLogger,
  createProxyHandler,
  createSupabaseUsageStore,
  createSupabaseUserResolver,
  readProxyEnv,
} from '../../../packages/proxy-core/src/index.ts';

const env = readProxyEnv((name) => Deno.env.get(name));

Deno.serve(
  createProxyHandler({
    apiKey: env.anthropicApiKey,
    fetch: (input, init) => fetch(input, init),
    store: createSupabaseUsageStore({
      url: env.supabaseUrl,
      serviceKey: env.supabaseServiceKey,
      fetch: (input, init) => fetch(input, init),
    }),
    resolveUser: createSupabaseUserResolver({
      url: env.supabaseUrl,
      apiKey: env.supabaseAnonKey,
      fetch: (input, init) => fetch(input, init),
    }),
    logger: createConsoleProxyLogger(),
    models: env.models,
    limits: env.limits,
  }),
);
