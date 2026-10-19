package expo.modules.steadilycapture

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Runs the JS task `SteadilyCaptureDrain` (registered by the app with
 * `AppRegistry.registerHeadlessTask`) so staged captures reach the inbox without opening the app.
 * The task receives only `{ pendingCount }`; the records themselves are read through `peekPending`.
 */
class CaptureDrainService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val data = Arguments.createMap()
    data.putInt("pendingCount", intent?.getIntExtra(EXTRA_PENDING_COUNT, 0) ?: 0)
    // Allowed in the foreground too: the app may come up while the task is starting.
    return HeadlessJsTaskConfig(TASK_NAME, data, TIMEOUT_MS, true)
  }

  companion object {
    const val TASK_NAME = "SteadilyCaptureDrain"
    const val EXTRA_PENDING_COUNT = "pendingCount"
    const val TIMEOUT_MS = 30_000L
  }
}
