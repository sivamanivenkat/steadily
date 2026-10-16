/**
 * Thin wrapper over the Android `steadily-capture` native module. On iOS, web and in Jest the
 * module is not linked, so every call is a safe no-op. Nothing here touches alert content.
 */
import { Platform } from 'react-native';
import type { CaptureHealth } from 'steadily-capture';

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

/** Staged captures waiting to be drained into the inbox. */
export const getPendingInboxCount = (): number => api()?.getPendingInboxCount() ?? 0;

/** Health snapshot, or null when unavailable. */
export const getCaptureHealth = (): CaptureHealth | null => api()?.getCaptureHealth() ?? null;

export const peekPending = (limit?: number) => api()?.peekPending(limit) ?? Promise.resolve([]);

export const acknowledgePending = (ids: readonly string[]) =>
  api()?.acknowledgePending(ids) ?? Promise.resolve(0);
