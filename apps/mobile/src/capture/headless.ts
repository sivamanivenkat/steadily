/**
 * Android Headless JS task: the native layer starts it after staging a capture while the app UI
 * is not running. It opens the encrypted database (the shared opener in `data/database.ts`),
 * drains the staging store, lets the agents run, and resolves so the service can stop. Nothing
 * here mounts UI. When the UI is alive in the same JS context, it reuses its database and runtime
 * and tells its screens to reload.
 */
import { AppRegistry, Platform } from 'react-native';

/** Must match the task name the native module starts. */
export const CAPTURE_DRAIN_TASK = 'SteadilyCaptureDrain';

type AppData = typeof import('../data/appDataSource');

export async function runCaptureDrainTask(
  load: () => AppData = () => require('../data/appDataSource') as AppData,
): Promise<void> {
  try {
    const app = load();
    await app.drainAppCaptures();
    const started = app.getStartedAppDataSource();
    if (started) {
      await (await started).refresh();
    } else {
      // Periodic agents too (housekeeping, budget checks), as on a foreground.
      await (await app.getAppCore()).runtime.tick();
    }
  } catch {
    // Nothing is logged: errors can echo database values. Records stay staged for next time.
  }
}

/** Registers the task. Android only; call once from the app entry. */
export function registerCaptureDrainTask(
  registry: Pick<typeof AppRegistry, 'registerHeadlessTask'> = AppRegistry,
  os: string = Platform.OS,
): void {
  if (os !== 'android') return;
  // The data layer loads lazily, inside the task, so registering costs nothing at startup.
  registry.registerHeadlessTask(CAPTURE_DRAIN_TASK, () => () => runCaptureDrainTask());
}
