# Steadily

A calm, privacy-first budget tracker for iOS and Android. Transactions are captured on the phone from purchase alerts, shares and screenshots, without bank logins.

## Repository layout

| Path                    | Contents                                                    |
| ----------------------- | ----------------------------------------------------------- |
| `apps/mobile`           | Expo / React Native app                                     |
| `packages/shared-types` | Zod schemas: transactions, events, agent contract, settings |
| `packages/taxonomy`     | Spending categories and IDs                                 |
| `packages/db`           | SQLite schema (Drizzle) and migrations                      |
| `packages/agent-core`   | Event bus, scheduler and on-device agents                   |

## Development

Requires Node 22+ and pnpm (via Corepack).

```sh
corepack enable
pnpm install
pnpm typecheck
pnpm test
```

Regenerate database migrations after changing `packages/db/src/schema.ts`:

```sh
pnpm --filter @steadily/db generate
```
