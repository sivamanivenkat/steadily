import { PermissionsAndroid } from 'react-native';

import {
  acknowledgePending,
  canPostCaptureNotifications,
  getCaptureNotificationsEnabled,
  needsNotificationPermission,
  requestNotificationPermission,
  setCaptureNotificationsEnabled,
  getCaptureHealth,
  getPendingInboxCount,
  isCaptureAvailable,
  isNotificationAccessEnabled,
  openBatterySettings,
  openNotificationAccessSettings,
  peekPending,
} from '../index';

describe('capture wrapper without the native module', () => {
  it('is a safe no-op', async () => {
    expect(isCaptureAvailable()).toBe(false);
    expect(isNotificationAccessEnabled()).toBe(false);
    expect(openNotificationAccessSettings()).toBe(false);
    expect(openBatterySettings()).toBe(false);
    expect(getPendingInboxCount()).toBe(0);
    expect(getCaptureHealth()).toBeNull();
    expect(await peekPending()).toEqual([]);
    expect(await acknowledgePending([])).toBe(0);
    expect(getCaptureNotificationsEnabled()).toBe(false);
    expect(canPostCaptureNotifications()).toBe(false);
    expect(() => setCaptureNotificationsEnabled(true)).not.toThrow();
  });
});

describe('notification permission', () => {
  const permissions = (result: string) => ({
    PERMISSIONS: PermissionsAndroid.PERMISSIONS,
    RESULTS: PermissionsAndroid.RESULTS,
    request: jest.fn(async () => result as never),
  });

  it('asks only on Android 13 and later', async () => {
    const ios = permissions('granted');
    expect(
      await requestNotificationPermission({ os: 'ios', version: '26.0', permissions: ios }),
    ).toBe('not_needed');
    const android12 = permissions('granted');
    expect(
      await requestNotificationPermission({ os: 'android', version: 32, permissions: android12 }),
    ).toBe('not_needed');
    expect(ios.request).not.toHaveBeenCalled();
    expect(android12.request).not.toHaveBeenCalled();
    expect(needsNotificationPermission({ os: 'android', version: 33, permissions: ios })).toBe(
      true,
    );
  });

  it('maps the Android answer', async () => {
    const granted = permissions(PermissionsAndroid.RESULTS.GRANTED);
    expect(
      await requestNotificationPermission({ os: 'android', version: 34, permissions: granted }),
    ).toBe('granted');
    expect(granted.request).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    expect(
      await requestNotificationPermission({
        os: 'android',
        version: 33,
        permissions: permissions(PermissionsAndroid.RESULTS.DENIED),
      }),
    ).toBe('denied');
    expect(
      await requestNotificationPermission({
        os: 'android',
        version: 33,
        permissions: permissions(PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN),
      }),
    ).toBe('blocked');
  });
});
