import { Id } from '@steadily/shared-types';
import { z } from 'zod';
import { getNativeModule, type CaptureSubscription, type SteadilyCaptureNative } from './native';
import { CaptureHealth, PendingBatch, PendingCapture, PendingCaptureEvent } from './schemas';

export { CaptureHealth, PendingCapture, PendingCaptureEvent } from './schemas';
export type { CaptureSubscription, SteadilyCaptureNative } from './native';

/**
 * Name of the Headless JS task the native side starts after staging captures in the background.
 * Register it with `AppRegistry.registerHeadlessTask(CAPTURE_DRAIN_TASK, ...)`. The task data is
 * `{ pendingCount }` only; read the records with `peekPending`.
 */
export const CAPTURE_DRAIN_TASK = 'SteadilyCaptureDrain';

type Native = SteadilyCaptureNative | null;

/** True when the native module is linked into this build (Android dev/release builds). */
export function isCaptureAvailable(native: Native = getNativeModule()): boolean {
  return native !== null;
}

/** Whether the user granted Steadily notification access. False when unavailable. */
export function isListenerEnabled(native: Native = getNativeModule()): boolean {
  return z.boolean().catch(false).parse(native?.isListenerEnabled());
}

/** Opens the system notification access screen. Returns false if it could not be opened. */
export function openListenerSettings(native: Native = getNativeModule()): boolean {
  return z.boolean().catch(false).parse(native?.openListenerSettings());
}

/** Opens the battery settings where the user can set Steadily to Unrestricted. */
export function openBatterySettings(native: Native = getNativeModule()): boolean {
  return z.boolean().catch(false).parse(native?.openBatterySettings());
}

/**
 * Turns the native "Logged $12.40 at Starbucks · Coffee" confirmation on or off. Stored natively
 * so the listener can read it while the app is closed. Defaults to on.
 */
export function setCaptureNotificationsEnabled(
  enabled: boolean,
  native: Native = getNativeModule(),
): void {
  native?.setCaptureNotificationsEnabled(z.boolean().parse(enabled));
}

/** Whether capture confirmations are turned on. False when unavailable. */
export function getCaptureNotificationsEnabled(native: Native = getNativeModule()): boolean {
  return z.boolean().catch(false).parse(native?.getCaptureNotificationsEnabled());
}

/**
 * Whether the system lets Steadily post notifications at all. On Android 13+ this stays false
 * until the app is granted POST_NOTIFICATIONS; confirmations are skipped silently until then.
 */
export function canPostCaptureNotifications(native: Native = getNativeModule()): boolean {
  return z.boolean().catch(false).parse(native?.canPostCaptureNotifications());
}

/** Number of staged captures waiting to be drained into the inbox. */
export function getPendingInboxCount(native: Native = getNativeModule()): number {
  return z.number().int().nonnegative().catch(0).parse(native?.getPendingCount());
}

/** Health snapshot for Settings and onboarding. Null when unavailable or malformed. */
export function getCaptureHealth(native: Native = getNativeModule()): CaptureHealth | null {
  const parsed = CaptureHealth.safeParse(native?.getHealth());
  return parsed.success ? parsed.data : null;
}

/**
 * Reads up to `limit` staged captures without removing them. Records that fail validation are
 * skipped, never thrown (their contents are not logged). Call `acknowledgePending` with the ids
 * only after they are safely stored.
 */
export async function peekPending(
  limit = 50,
  native: Native = getNativeModule(),
): Promise<PendingCapture[]> {
  if (!native) return [];
  const raw = PendingBatch.parse(await native.peekPending(limit));
  const out: PendingCapture[] = [];
  for (const json of raw) {
    try {
      const parsed = PendingCapture.safeParse(JSON.parse(json));
      if (parsed.success) out.push(parsed.data);
    } catch {
      // Malformed record: skip. Never include its content in an error message.
    }
  }
  return out;
}

/** Deletes staged captures by id. Returns how many were removed. */
export async function acknowledgePending(
  ids: readonly string[],
  native: Native = getNativeModule(),
): Promise<number> {
  if (!native || ids.length === 0) return 0;
  const valid = z.array(Id).parse([...ids]);
  return z
    .number()
    .int()
    .nonnegative()
    .catch(0)
    .parse(await native.ackPending(valid));
}

/**
 * Calls `listener` when captures were staged while the app is in the foreground, so JS can drain
 * right away (in the background the `CAPTURE_DRAIN_TASK` Headless JS task runs instead). Bursts
 * are debounced natively. Returns a subscription; a no-op one when the module is unavailable.
 */
export function addPendingCaptureListener(
  listener: (event: PendingCaptureEvent) => void,
  native: Native = getNativeModule(),
): CaptureSubscription {
  if (!native?.addListener) return { remove: () => undefined };
  return native.addListener('onPendingCapture', (raw) => {
    const parsed = PendingCaptureEvent.safeParse(raw);
    listener(parsed.success ? parsed.data : { pendingCount: 0 });
  });
}
