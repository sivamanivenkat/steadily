import type { PendingCaptureStore } from '../../capture/drain';
import { clearPendingCaptures, wipeAllData, WipeError, type WipeDeps } from '../wipe';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** In-memory stand-in for the native staging store. Records are synthetic. */
function fakeStore(records: string[], { refuse = false } = {}) {
  const queue = [...records];
  const store: PendingCaptureStore = {
    peekRaw: jest.fn(async (limit: number) => queue.slice(0, limit)),
    acknowledge: jest.fn(async (ids: readonly string[]) => {
      if (refuse) return 0;
      let removed = 0;
      for (let i = queue.length - 1; i >= 0; i--) {
        const parsed = (() => {
          try {
            return (JSON.parse(queue[i]!) as { id?: unknown }).id;
          } catch {
            return undefined;
          }
        })();
        if (typeof parsed === 'string' && ids.includes(parsed)) {
          queue.splice(i, 1);
          removed++;
        }
      }
      return removed;
    }),
  };
  return { store, queue };
}

describe('clearPendingCaptures', () => {
  it('is a no-op without the native module', async () => {
    expect(await clearPendingCaptures(null)).toEqual({ cleared: 0, stuck: 0 });
  });

  it('acknowledges every record with an id, valid or not, across batches', async () => {
    const records = Array.from({ length: 250 }, (_, i) =>
      JSON.stringify({ v: 1, id: id(i + 1), source: 'android_notification' }),
    );
    // A record that fails the capture schema but still has an id is removed too.
    records.push(JSON.stringify({ id: id(999), broken: true }));
    const { store, queue } = fakeStore(records);

    expect(await clearPendingCaptures(store)).toEqual({ cleared: 251, stuck: 0 });
    expect(queue).toHaveLength(0);
  });

  it('stops when only records without a readable id are left', async () => {
    const { store, queue } = fakeStore([
      'not json',
      JSON.stringify({ id: 'not-a-uuid' }),
      JSON.stringify({ id: id(1) }),
    ]);
    expect(await clearPendingCaptures(store)).toEqual({ cleared: 1, stuck: 2 });
    expect(queue).toHaveLength(2);
  });

  it('stops when the store removes nothing', async () => {
    const { store } = fakeStore([JSON.stringify({ id: id(1) })], { refuse: true });
    expect(await clearPendingCaptures(store)).toEqual({ cleared: 0, stuck: 1 });
    expect(store.peekRaw).toHaveBeenCalledTimes(1);
  });
});

describe('wipeAllData', () => {
  function deps(overrides: Partial<WipeDeps> = {}) {
    const calls: string[] = [];
    const base: WipeDeps = {
      clearStaging: jest.fn(async () => {
        calls.push('staging');
        return { cleared: 0, stuck: 0 };
      }),
      deleteDatabase: jest.fn(async () => {
        calls.push('database');
      }),
      deleteKey: jest.fn(async () => {
        calls.push('key');
      }),
    };
    return { calls, deps: { ...base, ...overrides } };
  }

  it('clears staged captures, then the database, then the key', async () => {
    const { calls, deps: d } = deps();
    await wipeAllData(d);
    expect(calls).toEqual(['staging', 'database', 'key']);
  });

  it('touches nothing else when staged captures cannot be cleared', async () => {
    const { deps: d } = deps({
      clearStaging: jest.fn(async () => {
        throw new Error('native failure with details');
      }),
    });
    const error = await wipeAllData(d).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WipeError);
    expect((error as WipeError).step).toBe('staging');
    expect((error as Error).message).toBe('Could not delete all data');
    expect(d.deleteDatabase).not.toHaveBeenCalled();
    expect(d.deleteKey).not.toHaveBeenCalled();
  });

  it('still deletes the key when the file cannot be deleted, and succeeds', async () => {
    const { deps: d } = deps({
      deleteDatabase: jest.fn(async () => {
        throw new Error('file busy');
      }),
    });
    await expect(wipeAllData(d)).resolves.toBeUndefined();
    expect(d.deleteKey).toHaveBeenCalled();
  });

  it('fails when neither the file nor the key could be deleted', async () => {
    const fail = jest.fn(async () => {
      throw new Error('nope');
    });
    const { deps: d } = deps({ deleteDatabase: fail, deleteKey: fail });
    await expect(wipeAllData(d)).rejects.toMatchObject({ step: 'database' });
  });
});
