/**
 * The app's data source on a device: the encrypted database, one agent runtime and the
 * repo-backed `DataSource`, created once per app process. Agents tick when the app comes to the
 * foreground, so captures stored by the native surfaces while the app was in the background
 * flow through the pipeline.
 */
import { randomUUID } from 'expo-crypto';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { openDatabase } from './database';
import { createRepoDataSource, type AlertCapture, type RepoDataSource } from './repoDataSource';
import { createAppRuntime } from './runtime';

// Hermes may lack crypto.randomUUID; expo-crypto always has it.
const newId = () => randomUUID();

let starting: Promise<RepoDataSource> | null = null;

async function start(): Promise<RepoDataSource> {
  const { db } = await openDatabase();
  const app = createAppRuntime(db, { newId });
  const sampleAlerts = __DEV__
    ? (): readonly AlertCapture[] =>
        (require('./sampleAlerts') as typeof import('./sampleAlerts')).sampleAlerts(new Date())
    : undefined;
  const source = createRepoDataSource({
    db,
    ...app,
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
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') source.refresh().catch(() => {});
    });
    return () => subscription.remove();
  }, [source]);

  return state;
}
