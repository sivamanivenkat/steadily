package expo.modules.steadilycapture

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.facebook.react.HeadlessJsTaskService

/**
 * Wakes the JS layer after the listener stages captures, so they are drained into the inbox.
 *
 * A burst of alerts is debounced into one wake-up. When the app is in the foreground and JS is
 * subscribed to `onPendingCapture`, the module event is emitted; otherwise the Headless JS task
 * `SteadilyCaptureDrain` is started. Neither path carries alert data, only the pending count.
 */
object DrainTrigger {
  const val QUIET_MS = 1_500L
  const val MAX_WAIT_MS = 10_000L

  private val debouncer = Debouncer(QUIET_MS, MAX_WAIT_MS)
  private val handler by lazy { Handler(Looper.getMainLooper()) }
  @Volatile private var appContext: Context? = null
  private val check = Runnable { onCheck() }

  /**
   * Set by the module while JS listens to `onPendingCapture`; null otherwise. Called on the main
   * thread with the current pending count.
   */
  @Volatile var foregroundEmitter: ((Int) -> Unit)? = null

  /** Call after a record was written to [PendingStore]. Safe from any thread. */
  fun onStaged(context: Context) {
    appContext = context.applicationContext
    val now = SystemClock.uptimeMillis()
    val due = debouncer.poke(now)
    handler.removeCallbacks(check)
    handler.postDelayed(check, (due - now).coerceAtLeast(0L))
  }

  private fun onCheck() {
    val now = SystemClock.uptimeMillis()
    if (debouncer.fireIfDue(now)) {
      appContext?.let { fire(it) }
    } else {
      debouncer.pendingAt()?.let { due -> handler.postDelayed(check, (due - now).coerceAtLeast(0L)) }
    }
  }

  private fun fire(context: Context) {
    try {
      val count = PendingStore(context).count()
      if (count == 0) return
      val emit = foregroundEmitter
      if (emit != null && isAppInForeground()) {
        emit(count)
        return
      }
      val intent = Intent(context, CaptureDrainService::class.java)
        .putExtra(CaptureDrainService.EXTRA_PENDING_COUNT, count)
      HeadlessJsTaskService.acquireWakeLockNow(context)
      context.startService(intent)
    } catch (_: Exception) {
      // Background start can be refused by the system. The app drains on its next launch.
    }
  }

  private fun isAppInForeground(): Boolean {
    val info = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(info)
    return info.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
  }
}
