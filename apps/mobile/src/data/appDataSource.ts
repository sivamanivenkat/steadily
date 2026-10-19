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
import { openDatabase } from './database';
import { createRepoDataSource, type AlertCapture, type RepoDataSource } from './repoDataSource';
import { createAppRuntime, type AppRuntime } from './runtime';

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
    ...(sampleAlerts ? { sampleAlerts } : {}),
  });
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

export type AppDataSourceState =
  { status: 'loading' } | { status: 'ready'; source: RepoDataSource } | { status: 'error' };

/** Opens the data source and keeps the agents running while the app is in the foreground. */
export function useAppDataSource(): AppDataSourceState {
  const [state, setState] = useState<AppDataSourceState>({ status: 'loading' });

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
  }, []);

  const source = state.status === 'ready' ? state.source : null;
  useEffect(() => {
    if (!source) return;
    // Drains native captures now, on every foreground and on native capture events, then lets
    // the agents run and screens reload.
    return startCaptureTriggers({ drain: drainAppCaptures, refresh: () => source.refresh() });
  }, [source]);

  return state;
}
