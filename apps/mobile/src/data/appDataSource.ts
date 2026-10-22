/**
 * The app's data source on a device: the encrypted database, one agent runtime and the
 * repo-backed `DataSource`, created once per app process. Agents tick when the app comes to the
 * foreground, so captures stored by the native surfaces while the app was in the background
 * flow through the pipeline.
 *
 * The database and runtime (`getAppCore`) are shared with the Headless JS capture drain, which
 * runs in the same JS context as the UI when both are alive, so there is one opener and one
 * runtime per process.
 */
import type { SteadilyDb } from '@steadily/db';
import { randomUUID } from 'expo-crypto';
import { useEffect, useState } from 'react';

import { drainPendingCaptures, type DrainResult } from '../capture/drain';
import { getPendingCaptureStore } from '../capture/index';
import { startCaptureTriggers } from '../capture/triggers';
import { closeAndDeleteDatabase, deleteDatabaseKey, openDatabase } from './database';
import { createRepoDataSource, type AlertCapture, type RepoDataSource } from './repoDataSource';
import { createAppRuntime, type AppRuntime } from './runtime';
import { clearPendingCaptures, WipeError, wipeAllData } from './wipe';

// Hermes may lack crypto.randomUUID; expo-crypto always has it.
const newId = () => randomUUID();

export type AppCore = AppRuntime & { db: SteadilyDb };

let core: Promise<AppCore> | null = null;

/** The opened database and the agent runtime, created once per app process. No UI. */
export function getAppCore(): Promise<AppCore> {
  if (!core) {
    core = openDatabase().then(
      ({ db }) => ({ db, ...createAppRuntime(db, { newId }) }),
      (error: unknown) => {
        core = null;
        throw error;
      },
    );
  }
  return core;
}

/**
 * Moves captures staged by the Android listener into the event bus and runs the agents on them.
 * A no-op without the native module (iOS, web, Expo Go).
 */
export async function drainAppCaptures(): Promise<DrainResult | null> {
  const store = getPendingCaptureStore();
  if (!store) return null;
  const { db, runtime } = await getAppCore();
  return drainPendingCaptures({ store, db, runtime });
}

let starting: Promise<RepoDataSource> | null = null;

async function start(): Promise<RepoDataSource> {
  const { db, runtime, repos } = await getAppCore();
  const sampleAlerts = __DEV__
    ? (): readonly AlertCapture[] =>
        (require('./sampleAlerts') as typeof import('./sampleAlerts')).sampleAlerts(new Date())
    : undefined;
  const source = createRepoDataSource({
    db,
    runtime,
    repos,
    newId,
    encryptedAtRest: true,
    ...(sampleAlerts ? { sampleAlerts } : {}),
  });
  source.deleteAllData = deleteAllAppData;
  // Purge expired captures and deliver anything left from the last session.
  await source.refresh();
  return source;
}

export function getAppDataSource(): Promise<RepoDataSource> {
  if (!starting) {
    starting = start().catch((error: unknown) => {
      starting = null;
      throw error;
    });
  }
  return starting;
}

/** The data source if the UI already started it, so background work can tell screens. */
export function getStartedAppDataSource(): Promise<RepoDataSource> | null {
  return starting;
}

const resetListeners = new Set<() => void>();

/**
 * "Delete all my data": wipes staged captures, the database and its key, then makes the app open
 * a new, empty database. The root layout reloads, and an empty database starts at onboarding.
 */
async function deleteAllAppData(): Promise<void> {
  try {
    await wipeAllData({
      clearStaging: () => clearPendingCaptures(getPendingCaptureStore()),
      deleteDatabase: closeAndDeleteDatabase,
      deleteKey: deleteDatabaseKey,
    });
  } catch (error) {
    // Staging failed: nothing was deleted and the database is still open, so the screen can
    // say so and the user can try again.
    if (error instanceof WipeError && error.step === 'staging') throw error;
    reopen();
    throw error;
  }
  reopen();
}

/** The old connection is closed: open everything again from scratch. */
function reopen(): void {
  core = null;
  starting = null;
  resetListeners.forEach((listener) => listener());
}

export type AppDataSourceState =
  { status: 'loading' } | { status: 'ready'; source: RepoDataSource } | { status: 'error' };

/** Opens the data source and keeps the agents running while the app is in the foreground. */
export function useAppDataSource(): AppDataSourceState {
  const [state, setState] = useState<AppDataSourceState>({ status: 'loading' });
  // Bumped after "Delete all my data" so the data source is opened again.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const onReset = () => {
      setState({ status: 'loading' });
      setGeneration((n) => n + 1);
    };
    resetListeners.add(onReset);
    return () => {
      resetListeners.delete(onReset);
    };
  }, []);

  useEffect(() => {
    let active = true;
    getAppDataSource().then(
      (source) => {
        if (active) setState({ status: 'ready', source });
      },
      () => {
        // The error is not logged: database errors can echo SQL or values.
        if (active) setState({ status: 'error' });
      },
    );
    return () => {
      active = false;
    };
  }, [generation]);

  const source = state.status === 'ready' ? state.source : null;
  useEffect(() => {
    if (!source) return;
    // Drains native captures now, on every foreground and on native capture events, then lets
    // the agents run and screens reload.
    return startCaptureTriggers({ drain: drainAppCaptures, refresh: () => source.refresh() });
  }, [source]);

  return state;
}
