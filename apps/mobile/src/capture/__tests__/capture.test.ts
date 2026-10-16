import {
  acknowledgePending,
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
  });
});
