# @steadily/mobile

The Steadily app: React Native + Expo (SDK 58) with expo-router. UI follows the "Calm Glass" design system (D-023).

## Layout

- `src/app/`: routes only (expo-router). Tabs live in `src/app/(tabs)/`.
- `src/screens/`: screen components used by routes.
- `src/components/`: shared UI (`Glass`, `ScreenBackground`, `SafeToSpendCard`, `PaceBar`, `TransactionRow`, `CategoryChip`, `IconButton`, `TabBar`, ...).
- `src/theme/`: tokens (`colors`, `glass`, `type`, `spacing`, `categories`). Screens and components never hard-code colors.
- `src/data/`: the `DataSource` interface screens read and write through, a React provider (`AppProviders`, `useData`, `useDataSource`), and the synthetic in-memory implementation (`createSyntheticDataSource`, seed in `syntheticSeed.ts`). Synthetic data only; packages/db repositories replace it later without screen changes. Nothing is persisted yet, so a cold start shows onboarding again.
- `src/content/`: local copy of the issuer alert guides (`verified: false`, placeholder steps). Real guides will come from Supabase (D-014).
- `src/testing/`: test helpers (`renderWithData`, router mock).

## Routes

- `(tabs)/index` Home, `(tabs)/activity`, `(tabs)/budgets`, `(tabs)/ask`
- `review`: review queue (from Home or Activity)
- `transaction/[id]`: transaction detail sheet with "What we kept"
- `budget-edit?categoryId=<id|overall>`: set or edit a budget
- `settings`
- `onboarding`: shown until onboarding is completed (`Stack.Protected` in the root layout); Settings can reopen it

## Commands

Run from the repo root (`pnpm typecheck`, `pnpm test`) or here:

```sh
pnpm start        # Metro dev server (needs a development build on a device or emulator)
pnpm typecheck
pnpm test
npx expo export --platform android   # bundle check without a device
npx expo-doctor
```

Add Expo packages with `pnpm expo install <pkg>` so versions match the SDK. `jest` and `@types/jest` are excluded from that check because `jest-expo` 58 requires Jest 30.
