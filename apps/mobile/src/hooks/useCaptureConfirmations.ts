import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';

import {
  canPostCaptureNotifications,
  getCaptureNotificationsEnabled,
  isCaptureAvailable,
  needsNotificationPermission,
  requestNotificationPermission,
  setCaptureNotificationsEnabled,
  type NotificationPermissionResult,
} from '@/capture';

export type CaptureConfirmations = {
  /** False on iOS, web and builds without the Android capture module: hide the controls. */
  available: boolean;
  /** The user's choice (stored natively). */
  enabled: boolean;
  /** The system allows Steadily's notifications. */
  canPost: boolean;
  /** Android 13+: the runtime permission can be asked for. */
  needsPermission: boolean;
  /** The last request said "Don't allow" for good: only system settings can change it. */
  blocked: boolean;
  setEnabled(enabled: boolean): void;
  /** Asks for the permission, or opens the app's system settings once blocked. */
  allow(): Promise<NotificationPermissionResult | 'opened_settings'>;
};

/**
 * The "Logged $X at Y" capture confirmation: the user's toggle plus whether Android lets it show.
 * Re-reads when the app returns to the foreground, since both can change in system settings.
 */
export function useCaptureConfirmations(): CaptureConfirmations {
  const available = isCaptureAvailable();
  const read = useCallback(
    () => ({
      enabled: available && getCaptureNotificationsEnabled(),
      canPost: available && canPostCaptureNotifications(),
    }),
    [available],
  );
  const [state, setState] = useState(read);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!available) return;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') setState(read());
    });
    return () => subscription.remove();
  }, [available, read]);

  const setEnabled = (enabled: boolean) => {
    setCaptureNotificationsEnabled(enabled);
    setState(read());
  };

  const allow = async () => {
    if (blocked || !needsNotificationPermission()) {
      // Older Android with notifications turned off, or permanently denied.
      await Linking.openSettings().catch(() => {});
      return 'opened_settings' as const;
    }
    const result = await requestNotificationPermission();
    if (result === 'blocked') setBlocked(true);
    setState(read());
    return result;
  };

  return {
    available,
    ...state,
    needsPermission: available && needsNotificationPermission(),
    blocked,
    setEnabled,
    allow,
  };
}
