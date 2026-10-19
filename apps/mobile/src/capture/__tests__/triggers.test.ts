import type { AppStateStatus } from 'react-native';

import type { DrainResult } from '../drain';
import { emptyDrainResult } from '../drain';
import { CAPTURE_DRAIN_TASK, registerCaptureDrainTask, runCaptureDrainTask } from '../headless';
import { startCaptureTriggers } from '../triggers';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const written = (n: number): DrainResult => ({ ...emptyDrainResult(), written: n });

function harness(results: Array<DrainResult | null>, withNative = true) {
  let appState: ((state: AppStateStatus) => void) | null = null;
  let native: (() => void) | null = null;
  const removed = { appState: false, native: false };
  const drain = jest.fn(async () => results.shift() ?? null);
  const refresh = jest.fn(async () => {});
  const stop = startCaptureTriggers({
    drain,
    refresh,
    onAppStateChange: (listener) => {
      appState = listener;
      return () => (removed.appState = true);
    },
    onPendingCapture: withNative
      ? (listener) => {
          native = listener;
          return () => (removed.native = true);
        }
      : () => null,
  });
  return {
    drain,
    refresh,
    stop,
    removed,
    setAppState: (state: AppStateStatus) => appState?.(state),
    fireNative: () => native?.(),
    hasNative: () => native !== null,
  };
}

describe('capture triggers', () => {
  it('drains on start and refreshes only when something arrived', async () => {
    const quiet = harness([written(0)]);
    await flush();
    expect(quiet.drain).toHaveBeenCalledTimes(1);
    expect(quiet.refresh).not.toHaveBeenCalled();

    const busy = harness([written(2)]);
    await flush();
    expect(busy.refresh).toHaveBeenCalledTimes(1);
  });

  it('drains and refreshes whenever the app becomes active', async () => {
    const t = harness([null, null]);
    await flush();
    t.setAppState('background');
    await flush();
    expect(t.drain).toHaveBeenCalledTimes(1);
    t.setAppState('active');
    await flush();
    expect(t.drain).toHaveBeenCalledTimes(2);
    // Foregrounding always ticks the agents, even with nothing staged (iOS).
    expect(t.refresh).toHaveBeenCalledTimes(1);
  });

  it('drains on the native capture event when the module emits it', async () => {
    const t = harness([null, written(1)]);
    await flush();
    t.fireNative();
    await flush();
    expect(t.drain).toHaveBeenCalledTimes(2);
    expect(t.refresh).toHaveBeenCalledTimes(1);
    t.stop();
    expect(t.removed).toEqual({ appState: true, native: true });
  });

  it('works without the native event and swallows drain errors', async () => {
    const t = harness([], false);
    expect(t.hasNative()).toBe(false);
    t.drain.mockRejectedValueOnce(new Error('db'));
    await flush();
    t.setAppState('active');
    await flush();
    expect(t.refresh).toHaveBeenCalledTimes(1);
    expect(() => t.stop()).not.toThrow();
  });
});

describe('headless capture drain', () => {
  it('registers the task by name on Android only', () => {
    const registry = { registerHeadlessTask: jest.fn() };
    registerCaptureDrainTask(registry, 'ios');
    expect(registry.registerHeadlessTask).not.toHaveBeenCalled();
    registerCaptureDrainTask(registry, 'android');
    expect(registry.registerHeadlessTask).toHaveBeenCalledWith(
      'SteadilyCaptureDrain',
      expect.any(Function),
    );
    expect(CAPTURE_DRAIN_TASK).toBe('SteadilyCaptureDrain');
  });

  function fakeApp(started: boolean) {
    const calls: string[] = [];
    const runtime = { tick: jest.fn(async () => void calls.push('tick')) };
    const source = { refresh: jest.fn(async () => void calls.push('refresh')) };
    const app = {
      drainAppCaptures: jest.fn(async () => {
        calls.push('drain');
        return written(1);
      }),
      getStartedAppDataSource: () => (started ? Promise.resolve(source) : null),
      getAppCore: async () => ({ runtime }),
    };
    return { app: app as unknown as typeof import('../../data/appDataSource'), calls };
  }

  it('drains then ticks the runtime when no UI is running', async () => {
    const { app, calls } = fakeApp(false);
    await runCaptureDrainTask(() => app);
    expect(calls).toEqual(['drain', 'tick']);
  });

  it('reuses the foreground data source when the UI is alive', async () => {
    const { app, calls } = fakeApp(true);
    await runCaptureDrainTask(() => app);
    expect(calls).toEqual(['drain', 'refresh']);
  });

  it('resolves even when the database cannot open', async () => {
    const { app } = fakeApp(false);
    (app.drainAppCaptures as jest.Mock).mockRejectedValueOnce(new Error('locked'));
    await expect(runCaptureDrainTask(() => app)).resolves.toBeUndefined();
  });
});
