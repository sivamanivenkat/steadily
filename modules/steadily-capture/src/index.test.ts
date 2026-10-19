import { describe, expect, it, vi } from 'vitest';
import type { SteadilyCaptureNative } from './native';

// The real native lookup needs the React Native runtime; the API takes the module as a parameter.
vi.mock('expo', () => ({ requireOptionalNativeModule: () => null }));

const {
  CAPTURE_DRAIN_TASK,
  addPendingCaptureListener,
  acknowledgePending,
  canPostCaptureNotifications,
  getCaptureHealth,
  getCaptureNotificationsEnabled,
  getPendingInboxCount,
  isCaptureAvailable,
  isListenerEnabled,
  openListenerSettings,
  peekPending,
  setCaptureNotificationsEnabled,
} = await import('./index');

const ID = '3f2b8c1e-5a41-4d7e-9c3a-1b2c3d4e5f60';

function fake(overrides: Partial<SteadilyCaptureNative> = {}): SteadilyCaptureNative {
  return {
    isListenerEnabled: () => true,
    openListenerSettings: () => true,
    openBatterySettings: () => true,
    getPendingCount: () => 2,
    getHealth: () => ({
      listenerEnabled: true,
      lastAlertSeenAt: null,
      lastCaptureAt: 1760000000000,
      ignoringBatteryOptimizations: false,
      manufacturer: 'oneplus',
      pendingCount: 2,
    }),
    peekPending: async () => [],
    ackPending: async () => 0,
    setCaptureNotificationsEnabled: () => undefined,
    getCaptureNotificationsEnabled: () => true,
    canPostCaptureNotifications: () => true,
    ...overrides,
  };
}

describe('without the native module', () => {
  it('returns safe defaults', async () => {
    expect(isCaptureAvailable(null)).toBe(false);
    expect(isListenerEnabled(null)).toBe(false);
    expect(openListenerSettings(null)).toBe(false);
    expect(getPendingInboxCount(null)).toBe(0);
    expect(getCaptureHealth(null)).toBeNull();
    expect(await peekPending(10, null)).toEqual([]);
    expect(await acknowledgePending([ID], null)).toBe(0);
    const sub = addPendingCaptureListener(() => undefined, null);
    expect(() => sub.remove()).not.toThrow();
    expect(getCaptureNotificationsEnabled(null)).toBe(false);
    expect(canPostCaptureNotifications(null)).toBe(false);
    expect(() => setCaptureNotificationsEnabled(true, null)).not.toThrow();
  });
});

describe('with the native module', () => {
  it('passes validated values through', () => {
    const native = fake();
    expect(isListenerEnabled(native)).toBe(true);
    expect(getPendingInboxCount(native)).toBe(2);
    expect(getCaptureHealth(native)?.manufacturer).toBe('oneplus');
  });

  it('falls back when the native values have the wrong shape', () => {
    const native = fake({
      isListenerEnabled: () => 'yes' as unknown as boolean,
      getPendingCount: () => -3,
      getHealth: () => ({ listenerEnabled: 'x' }),
    });
    expect(isListenerEnabled(native)).toBe(false);
    expect(getPendingInboxCount(native)).toBe(0);
    expect(getCaptureHealth(native)).toBeNull();
  });

  it('keeps valid pending captures and skips malformed ones', async () => {
    const good = {
      v: 1,
      id: ID,
      source: 'android_notification',
      capturedAt: '2026-10-14T15:12:01.000Z',
      extracted: {
        amountMinor: 2540,
        currency: 'USD',
        direction: 'debit',
        merchantRaw: 'STARBUCKS STORE 1234',
        occurredAt: '2026-10-14T15:12:00.000Z',
        accountLast4: '4821',
        issuerId: 'chase',
      },
      merchantName: 'Starbucks',
      quickCategory: { categoryId: 'food.coffee', confidence: 0.92, source: 'dictionary' },
    };
    const native = fake({
      peekPending: async () => [
        JSON.stringify(good),
        '{not json',
        JSON.stringify({ ...good, extracted: { ...good.extracted, currency: 'usd' } }),
      ],
    });
    const out = await peekPending(10, native);
    expect(out).toHaveLength(1);
    expect(out[0]?.extracted.amountMinor).toBe(2540);
  });

  it('rejects non-uuid ids on acknowledge', async () => {
    await expect(acknowledgePending(['../etc'], fake())).rejects.toThrow();
  });
});

describe('pending capture events', () => {
  it('uses the task name the native service starts', () => {
    expect(CAPTURE_DRAIN_TASK).toBe('SteadilyCaptureDrain');
  });

  it('subscribes to onPendingCapture and validates the payload', () => {
    let emit: (event: unknown) => void = () => undefined;
    const remove = vi.fn();
    const addListener = vi.fn((name: 'onPendingCapture', cb: (event: unknown) => void) => {
      expect(name).toBe('onPendingCapture');
      emit = cb;
      return { remove };
    });
    const seen: number[] = [];
    const sub = addPendingCaptureListener((e) => seen.push(e.pendingCount), fake({ addListener }));
    emit({ pendingCount: 3 });
    emit({ pendingCount: 'many' });
    expect(seen).toEqual([3, 0]);
    sub.remove();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('is a no-op when the module has no event support', () => {
    const sub = addPendingCaptureListener(() => undefined, fake());
    expect(() => sub.remove()).not.toThrow();
  });
});

describe('capture notification setting', () => {
  it('stores the flag natively and reads it back', () => {
    let stored = true;
    const native = fake({
      setCaptureNotificationsEnabled: (enabled) => {
        stored = enabled;
      },
      getCaptureNotificationsEnabled: () => stored,
      canPostCaptureNotifications: () => 'no' as unknown as boolean,
    });
    setCaptureNotificationsEnabled(false, native);
    expect(getCaptureNotificationsEnabled(native)).toBe(false);
    expect(canPostCaptureNotifications(native)).toBe(false);
  });
});
