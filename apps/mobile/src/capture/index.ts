/**
 * Thin wrapper over the Android `steadily-capture` native module. On iOS, web and in Jest the
 * module is not linked, so every call is a safe no-op. Nothing here touches alert content.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import type { CaptureHealth } from 'steadily-capture';

import type { PendingCaptureStore } from './drain';

type CaptureApi = typeof import('steadily-capture');

let cached: CaptureApi | null | undefined;

/** Loads the module on Android only; a missing or broken native build falls back to no-ops. */
function api(): CaptureApi | null {
  if (cached !== undefined) return cached;
  if (Platform.OS !== 'android') {
    cached = null;
    return cached;
  }
  try {
    const loaded = require('steadily-capture') as CaptureApi;
    cached = loaded.isCaptureAvailable() ? loaded : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** True when the Android capture module is linked into this build. */
export const isCaptureAvailable = (): boolean => api() !== null;

/** Whether the user granted notification access. False when unavailable. */
export const isNotificationAccessEnabled = (): boolean => api()?.isListenerEnabled() ?? false;

/** Opens the system notification access screen. Returns false when it could not open. */
export const openNotificationAccessSettings = (): boolean => api()?.openListenerSettings() ?? false;

/** Opens battery settings so the user can pick Unrestricted. */
export const openBatterySettings = (): boolean => api()?.openBatterySettings() ?? false;

/** Whether the "Logged $X at Y" confirmation is turned on. False when unavailable. */
export const getCaptureNotificationsEnabled = (): boolean =>
  api()?.getCaptureNotificationsEnabled() ?? false;

/** Turns the "Logged $X at Y" confirmation on or off (stored natively). */
export const setCaptureNotificationsEnabled = (enabled: boolean): void => {
  api()?.setCaptureNotificationsEnabled(enabled);
};

/** Whether the system lets Steadily post notifications. False when unavailable. */
export const canPostCaptureNotifications = (): boolean =>
  api()?.canPostCaptureNotifications() ?? false;

export type NotificationPermissionResult = 'granted' | 'denied' | 'blocked' | 'not_needed';

type PermissionDeps = {
  os: string;
  /** Android API level (`Platform.Version`). */
  version: number | string;
  permissions: Pick<typeof PermissionsAndroid, 'request' | 'PERMISSIONS' | 'RESULTS'>;
};

const defaultPermissionDeps = (): PermissionDeps => ({
  os: Platform.OS,
  version: Platform.Version,
  permissions: PermissionsAndroid,
});

/** Android 13 (API 33) added the runtime POST_NOTIFICATIONS permission. */
export const POST_NOTIFICATIONS_MIN_API = 33;

/** True when this phone needs the runtime notification permission (Android 13+). */
export function needsNotificationPermission(deps: PermissionDeps = defaultPermissionDeps()) {
  return deps.os === 'android' && Number(deps.version) >= POST_NOTIFICATIONS_MIN_API;
}

/**
 * Asks for POST_NOTIFICATIONS on Android 13+ (the module's manifest declares it). Uses
 * `PermissionsAndroid`, so no extra native dependency. Older Android and iOS: `not_needed`.
 * `blocked` means the user chose "Don't allow" twice; only system settings can change it now.
 */
export async function requestNotificationPermission(
  deps: PermissionDeps = defaultPermissionDeps(),
): Promise<NotificationPermissionResult> {
  if (!needsNotificationPermission(deps)) return 'not_needed';
  const { permissions } = deps;
  try {
    const result = await permissions.request(permissions.PERMISSIONS.POST_NOTIFICATIONS);
    if (result === permissions.RESULTS.GRANTED) return 'granted';
    if (result === permissions.RESULTS.NEVER_ASK_AGAIN) return 'blocked';
    return 'denied';
  } catch {
    return 'denied';
  }
}

/** Staged captures waiting to be drained into the inbox. */
export const getPendingInboxCount = (): number => api()?.getPendingInboxCount() ?? 0;

/** Health snapshot, or null when unavailable. */
export const getCaptureHealth = (): CaptureHealth | null => api()?.getCaptureHealth() ?? null;

export const peekPending = (limit?: number) => api()?.peekPending(limit) ?? Promise.resolve([]);

export const acknowledgePending = (ids: readonly string[]) =>
  api()?.acknowledgePending(ids) ?? Promise.resolve(0);

type RawNative = { peekPending(limit: number): Promise<unknown> };

/**
 * The staging store for `drainPendingCaptures`, or null when capture is unavailable.
 *
 * Reads raw records instead of using the module's `peekPending`, which silently skips records
 * that fail validation: those would never be acknowledged and would sit at the head of the queue
 * forever. The drain validates with the module's `PendingCapture` schema itself.
 */
export function getPendingCaptureStore(): PendingCaptureStore | null {
  const loaded = api();
  if (!loaded) return null;
  let native: RawNative | null;
  try {
    const nativeApi =
      require('steadily-capture/src/native') as typeof import('steadily-capture/src/native');
    native = nativeApi.getNativeModule();
  } catch {
    native = null;
  }
  if (!native) return null;
  const raw = native;
  return {
    async peekRaw(limit) {
      const batch = await raw.peekPending(limit);
      return Array.isArray(batch) ? batch.filter((json) => typeof json === 'string') : [];
    },
    acknowledge: (ids) => loaded.acknowledgePending(ids),
  };
}

type Unsubscribe = () => void;

/**
 * Calls `listener` when the native layer stages a new capture. Uses `addPendingCaptureListener`
 * only if this build of the module exports it; returns null otherwise (the app still drains on
 * start and on foreground).
 */
export function subscribeToPendingCaptures(listener: () => void): Unsubscribe | null {
  const loaded = api() as (CaptureApi & { addPendingCaptureListener?: unknown }) | null;
  const add = loaded?.addPendingCaptureListener;
  if (typeof add !== 'function') return null;
  try {
    const subscription: unknown = add(() => listener());
    if (typeof subscription === 'function') return subscription as Unsubscribe;
    const remove = (subscription as { remove?: unknown } | null)?.remove;
    if (typeof remove === 'function') return () => remove.call(subscription);
    return () => {};
  } catch {
    return null;
  }
}
