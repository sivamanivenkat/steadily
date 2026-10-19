# steadily-capture

Android capture layer (Kotlin Expo module). iOS and web builds do not link it; the TypeScript API
returns safe defaults there (`src/index.ts`).

## What it does

1. `SteadilyNotificationListener` receives notifications. Packages outside the allow-list (every
   `sources.androidPackages` entry in `packages/rule-packs/packs` plus common SMS apps) are dropped
   before any content is read.
2. The fast path (`fastpath/`) runs the shared rule packs, normalizes the merchant and
   quick-categorizes from `packages/merchants`. It is a Kotlin port of the TypeScript reference.
3. Only extracted fields (amount in minor units, merchant, last 4, issuer, timestamps, quick
   category) are written. Title and text are never stored, logged or sent.
4. JS drains the staged records with `peekPending` / `acknowledgePending`.
5. Right after staging, a quiet local notification confirms the capture and JS is woken to drain
   (see below).

## Waking JS to drain

After each staged capture, `DrainTrigger` debounces (1.5 s of quiet, at most 10 s) so a burst of
alerts produces one wake-up:

- App in the foreground and JS subscribed with `addPendingCaptureListener`: the module event
  `onPendingCapture` fires with `{ pendingCount }`.
- Otherwise the Headless JS task **`SteadilyCaptureDrain`** (`CAPTURE_DRAIN_TASK`) is started via
  `CaptureDrainService`. Its data is `{ pendingCount }` only; no alert data is in the Intent. The app
  registers it with `AppRegistry.registerHeadlessTask(CAPTURE_DRAIN_TASK, () => drain)` in the entry
  file, outside any component.

If the system refuses the background start, the records stay staged and the next app launch drains
them.

## Capture confirmation notification

`CaptureNotifier` posts "Logged $12.40 at Starbucks · Coffee" on the low-importance channel
`captures` ("Logged purchases"). The category label shows only when the quick category confidence
is at least 0.85 (D-020); otherwise it reads "Needs review". Tap and the "Change" action open
`steadily://review`. The lock screen shows only "Transaction logged", and the notification is not
bridged to watches.

- Turn off with `setCaptureNotificationsEnabled(false)` (stored natively, default on).
- Android 13+ needs the `POST_NOTIFICATIONS` runtime permission (declared in this module's
  manifest; the app must request it). Without it, posting is skipped silently.
  `canPostCaptureNotifications()` reports the current state.
- Category labels in `CaptureText.kt` are a copy of `packages/taxonomy`; tests on both sides fail
  if they drift.

## Quick Settings tile

"Log expense" (`LogExpenseTileService`). The app has no manual-entry route yet, so a tap opens the
app's start screen; switch it to `steadily://add` when that route exists. The user adds the tile
from the Quick Settings edit panel.

No network code and no `INTERNET` permission in this module (unit tests enforce both, plus no
`Log` calls). Declared permissions: `WAKE_LOCK` (Headless JS start) and `POST_NOTIFICATIONS`.

## Encrypted inbox: how it is stored

`apps/mobile/src/data/database.ts` opens `steadily.db` with SQLCipher through `expo-sqlite`; the
256-bit key lives in `expo-secure-store` (JS side). Native Kotlin cannot reuse that safely: the
SQLCipher engine is private to `expo-sqlite`, and the key sits in secure-store's private
SharedPreferences format.

So the listener writes to a native **staging store** (`PendingStore`): one record per capture,
AES-256-GCM, key held in the Android Keystore, record id bound as associated data, capped at 500.
The app drains it into the SQLCipher inbox/event bus (record shape = `PendingCapture` in
`src/schemas.ts`, matching `transaction.captured`). Wiring that drain into the agent runtime is a
follow-up. Alternative if one store is preferred: bundle `sqlcipher-android` in this module and pass
the database key down from JS at startup.

## Rule packs and fixtures

`android/build.gradle` copies `packages/rule-packs/packs` and `packages/merchants/data/merchants.json`
into APK assets at build time, so there is one source of truth. Pack order for the Kotlin side
(`CaptureEngine.BUNDLE_ORDER`) must equal `BUILT_IN_PACKS`; `src/parity.test.ts` checks it.

## Tests

TypeScript (API validation, golden file, pack order):

```
pnpm --filter steadily-capture test
```

Kotlin JUnit (runs every case in `packages/rule-packs/fixtures`, the merchant golden file and the
engine tests). Needs a generated Android project, which is gitignored:

```
cd apps/mobile
npx expo prebuild --platform android --no-install   # once; needs android.package in app.json
cd android
# Windows: JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
#          ANDROID_HOME="C:\Users\<you>\AppData\Local\Android\Sdk"
./gradlew :steadily-capture:testDebugUnitTest
```

Reports: `modules/steadily-capture/android/build/reports/tests/testDebugUnitTest/index.html`.

After changing merchant normalization or the dictionary, regenerate the golden file with
`UPDATE_GOLDEN=1 pnpm --filter steadily-capture test`, then rerun the Kotlin tests.

## Device test checklist

Use a Play-installed or internal-testing build where possible: Android 13+ blocks notification
access for sideloaded apps until the user opens App info, menu, "Allow restricted settings".

1. Install the dev build. Onboarding, Connect step: tap "Open notification access", enable Steadily.
   Return to the app and check the step shows access is on.
2. Post a test alert from an allow-listed app (or send an SMS to the phone in a bank-alert format
   from a second phone). Expect the pending count to rise by one; nothing for other apps.
3. Confirm no alert text appears in `adb logcat` (filter on the package).
4. Battery: set Steadily to Unrestricted. Xiaomi: also enable Autostart and "No restrictions".
   Samsung: remove from "Sleeping apps". OnePlus/Oppo: allow background activity and auto-launch.
   Lock the phone for 30 minutes, send an alert, check it was captured.
5. Android 15: sensitive notification content can be redacted for apps without the permission;
   check an OTP-style alert and a purchase alert (redacted ones simply do not parse).
6. Toggle notification access off: health reports `listenerEnabled: false`.
7. Reboot and repeat step 2 (the service rebinds by itself).
8. Confirmation: after a captured alert, "Logged $X at Merchant · Category" appears once, silently,
   under the "Logged purchases" channel. A Target-style multi-category merchant reads "Needs
   review". Tap it and tap "Change": both open the Review screen. On the lock screen it shows only
   "Transaction logged".
9. Burst: post three alerts within a few seconds. Expect three confirmations but one drain (pending
   count drops to zero once the JS drain is in place).
10. Background drain: swipe the app away, post an alert, wait about 5 seconds, open the app; the
    capture is already in the inbox (needs the JS task registered).
11. Turn confirmations off in the app setting, post an alert: no confirmation, capture still staged.
12. Android 13+ only: deny notification permission, post an alert: no confirmation, no crash.
13. Tile: Quick Settings, edit, drag "Log expense" in. Tap it unlocked and locked (asks to unlock
    first); the app opens and the shade collapses.
