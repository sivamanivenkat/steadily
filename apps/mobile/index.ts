/**
 * App entry: the router, plus the Android Headless JS capture drain. The native layer starts the
 * task by name after the bundle has loaded, so registering here is early enough. Registering
 * mounts nothing; the UI only mounts when an activity starts.
 */
import 'expo-router/entry';

import { registerCaptureDrainTask } from './src/capture/headless';

registerCaptureDrainTask();
