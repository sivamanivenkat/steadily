# @steadily/mobile

The Steadily app: React Native + Expo (SDK 58) with expo-router. UI follows the "Calm Glass" design system (D-023).

## Layout

- `src/app/`: routes only (expo-router). Tabs live in `src/app/(tabs)/`.
- `src/screens/`: screen components used by routes.
- `src/components/`: shared UI (`Glass`, `ScreenBackground`, `SafeToSpendCard`, `PaceBar`, `TransactionRow`, `CategoryChip`, `IconButton`, `TabBar`, ...).
- `src/theme/`: tokens (`colors`, `glass`, `type`, `spacing`, `categories`). Screens and components never hard-code colors.
- `src/fixtures/`: synthetic demo data only.

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
