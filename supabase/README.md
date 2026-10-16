# Steadily backend (Supabase)

The backend is deliberately small (D-011, D-018). It stores **no transactions and no personal or financial data**. It provides:

- **Anonymous auth**: each device gets an anonymous session, used only to rate-limit the cloud proxy.
- **`claude-proxy` edge function**: the only path from the app to Claude, used only when the user opted in to cloud AI.
- **Usage counters**: per anonymous user id and UTC day, plus a global daily spend total. Nothing else.

Public content (issuer guides, rule packs, merchant dictionary) in Storage is planned but not part of this skeleton.

## Layout

| Path                                        | What                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `config.toml`                               | CLI config: anonymous sign-ins on, email/SMS sign-up off, function config                                        |
| `migrations/20261015000000_proxy_usage.sql` | `proxy_usage`, `proxy_spend` tables (RLS on, no policies) + service-only RPCs                                    |
| `functions/claude-proxy/index.ts`           | Thin Deno entry (`Deno.serve`)                                                                                   |
| `functions/claude-proxy/deno.json`          | Import map for the shared TypeScript packages                                                                    |
| `functions/.env.example`                    | Variable names for local `supabase functions serve`                                                              |
| `../packages/proxy-core`                    | All proxy logic (validation, Claude requests, limits, logging) and the app client, tested with Vitest under Node |

## Privacy guarantees

- Requests are validated with zod; only two request types exist (`categorize`, `ask`). Unknown fields are rejected.
- The function logs exactly one line per request: `{ event, requestType, status, latencyMs, inputTokens, outputTokens }`. Never bodies, merchant text, questions, tool data, user ids or keys. A test enforces this.
- Error responses carry only an error code, never upstream error text.
- `proxy_usage` / `proxy_spend` have RLS enabled with no policies, and table privileges are revoked from `anon` and `authenticated`. The RPCs are executable only by `service_role` (the edge function).
- The Anthropic API key exists only as a Supabase secret. It is never in the app or the repo.

## Deploy (done by the project owner)

Requires the Supabase CLI and a Supabase project.

```sh
# 1. Link the project (replaces the placeholder project_id locally)
supabase link --project-ref <project-ref>

# 2. Apply migrations
supabase db push

# 3. Set the Anthropic key as a secret (never commit it)
supabase secrets set ANTHROPIC_API_KEY=<your key>
#    Optional overrides:
#    supabase secrets set PROXY_DAILY_SPEND_CAP_USD=5 PROXY_DAILY_ASK_PER_USER=30 PROXY_DAILY_CATEGORIZE_PER_USER=300

# 4. Deploy the function (run from the repo root so ../packages is in the bundle)
supabase functions deploy claude-proxy
```

The function imports `packages/proxy-core` and `packages/taxonomy` by relative path (mapped in `deno.json`). Check on the first deploy that the CLI bundles them; if your CLI version only bundles files under `supabase/functions`, copy those two `src` folders into `supabase/functions/_shared/` as a deploy step and point the imports there.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase automatically.

Optional: prune old counters daily with `pg_cron` (Dashboard → Integrations → Cron):

```sql
select cron.schedule('proxy-prune', '15 0 * * *', $$select public.proxy_prune_usage(7)$$);
```

### Anonymous auth setup

1. Dashboard → Authentication → Sign In / Providers: enable **Allow anonymous sign-ins** (already on in `config.toml` for local).
2. Keep email and phone sign-up disabled for MVP.
3. Recommended: enable CAPTCHA (Turnstile or hCaptcha) for anonymous sign-ins to limit abuse, and keep the anonymous sign-in rate limit low (`[auth.rate_limit] anonymous_users`).
4. In the app: `supabase.auth.signInAnonymously()` once, on opt-in to cloud AI, and pass the session access token to the proxy client. The session is never linked to an email or profile in MVP.

### Local run

```sh
supabase start
cp supabase/functions/.env.example supabase/functions/.env   # fill in ANTHROPIC_API_KEY locally only
supabase functions serve claude-proxy --env-file supabase/functions/.env
```

## Endpoint contract: `POST /functions/v1/claude-proxy`

Headers: `Authorization: Bearer <anonymous session access token>`, `Content-Type: application/json`. Whole body at most 32 KB. Every response is JSON with `Cache-Control: no-store`. Source of truth: `packages/proxy-core/src/schemas.ts`.

### `categorize` (Claude Haiku 5.5)

Request (no other fields allowed):

```ts
{
  type: 'categorize';
  merchant: string;        // trimmed, 1..200 chars
  amountMinor: number;     // integer cents, |value| <= 1e12; negative for refunds
  allowed: CategoryId[];   // 1..40 unique ids, each valid per @steadily/taxonomy isCategoryId
}
```

Response `200`:

```ts
{
  type: 'categorize';
  result: { categoryId: CategoryId; confidence: number } | null;  // confidence in [0, 1]
}
```

The model is forced to call a tool whose `categoryId` is an enum of exactly `allowed`. The output is validated again; if the model returns anything outside `allowed` or an invalid confidence, `result` is `null`.

### `ask` (Claude Sonnet 5.5): one step of the on-device tool loop

Tools run on the device. The app sends the question, the tool definitions it can run, and the results of every tool call made so far. The proxy returns either more tool calls or the final answer. The app runs the calls locally and repeats with the results appended (it should stop after a few rounds).

Request:

```ts
{
  type: 'ask';
  question: string; // trimmed, 1..500 chars
  tools: Array<{
    // max 12, unique names, serialized <= 12 KB
    name: string; // /^[a-zA-Z0-9_-]{1,64}$/
    description: string; // 1..1024 chars
    input_schema: { type: 'object'; [k: string]: Json };
  }>;
  toolResults: Array<{
    // max 24, serialized <= 16 KB, unique ids
    id: string; // the call id returned by a previous step
    name: string; // must be one of `tools`
    input: Record<string, Json>; // the input the model asked for
    output: Json; // aggregates only (totals, counts), never raw transactions
  }>;
}
```

Response `200`, one of:

```ts
{
  type: 'ask';
  kind: 'tool_calls';
  calls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
}
{
  type: 'ask';
  kind: 'answer';
  text: string;
}
```

Tool calls naming a tool that was not declared are treated as an upstream error.

### Errors

Body `{ error: code }`:

| Status | `error`              | When                                                     |
| ------ | -------------------- | -------------------------------------------------------- |
| 400    | `invalid_request`    | Malformed JSON, unknown type, schema or size-cap failure |
| 401    | `unauthorized`       | Missing or invalid session token                         |
| 405    | `method_not_allowed` | Anything other than POST                                 |
| 413    | `payload_too_large`  | Body over 32 KB                                          |
| 429    | `rate_limited`       | Per-user daily limit for that request type reached       |
| 500    | `server_error`       | Usage store unavailable (fails closed)                   |
| 502    | `upstream_error`     | Claude API error or unusable model output                |
| 503    | `spend_cap_reached`  | Global daily spend cap reached                           |

The app should treat every error as "no cloud answer" and fall back (rules, review queue, on-device). The provided client (`@steadily/proxy-core/client`, `createProxyLlmClient`) implements `LlmPort.chooseCategory` this way.

### Limits (defaults, override with secrets)

| Limit                          | Default | Secret                            |
| ------------------------------ | ------- | --------------------------------- |
| `categorize` per user per day  | 300     | `PROXY_DAILY_CATEGORIZE_PER_USER` |
| `ask` per user per day         | 30      | `PROXY_DAILY_ASK_PER_USER`        |
| Global spend per UTC day (USD) | 5       | `PROXY_DAILY_SPEND_CAP_USD`       |

Spend is estimated from token usage with per-model prices in `packages/proxy-core/src/limits.ts` (update them if pricing changes). The cap is checked before each call and spend is added after it, so it can be overshot by at most the requests in flight. Model ids can be overridden with `CLAUDE_CATEGORIZE_MODEL` and `CLAUDE_ASK_MODEL`.
