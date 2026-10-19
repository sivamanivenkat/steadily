/**
 * When the foreground app drains native captures: once at start, whenever the app becomes active,
 * and on the native "capture staged" event if this build of the module emits it.
 */
import { AppState, type AppStateStatus } from 'react-native';

import type { DrainResult } from './drain';
import { subscribeToPendingCaptures } from './index';

type Unsubscribe = () => void;

export interface CaptureTriggerDeps {
  /** Null when capture is unavailable on this platform. */
  drain: () => Promise<DrainResult | null>;
  /** Runs agent ticks and reloads screens. */
  refresh: () => Promise<void>;
  onAppStateChange?: (listener: (state: AppStateStatus) => void) => Unsubscribe;
  onPendingCapture?: (listener: () => void) => Unsubscribe | null;
}

const appStateChanges = (listener: (state: AppStateStatus) => void): Unsubscribe => {
  const subscription = AppState.addEventListener('change', listener);
  return () => subscription.remove();
};

/** Starts the triggers; the returned function stops them. Errors are swallowed, never logged. */
export function startCaptureTriggers(deps: CaptureTriggerDeps): Unsubscribe {
  const onAppStateChange = deps.onAppStateChange ?? appStateChanges;
  const onPendingCapture = deps.onPendingCapture ?? subscribeToPendingCaptures;

  /** Screens only need a reload when something new reached the bus. */
  const drainThenRefresh = async (alwaysRefresh: boolean) => {
    let result: DrainResult | null = null;
    try {
      result = await deps.drain();
    } catch {
      // Left staged; the next trigger retries.
    }
    if (alwaysRefresh || (result !== null && result.written + result.duplicates > 0)) {
      await deps.refresh().catch(() => {});
    }
  };

  void drainThenRefresh(false);
  // Foregrounding always ticks the agents, as before; draining first adds new captures.
  const stopAppState = onAppStateChange((state) => {
    if (state === 'active') void drainThenRefresh(true);
  });
  const stopNative = onPendingCapture(() => void drainThenRefresh(false));

  return () => {
    stopAppState();
    stopNative?.();
  };
}
