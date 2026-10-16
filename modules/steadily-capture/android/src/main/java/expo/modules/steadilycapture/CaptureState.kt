package expo.modules.steadilycapture

import android.content.Context

/**
 * Health timestamps only: when an allow-listed alert was last seen and when one last produced a
 * capture. No alert content is ever kept here.
 */
class CaptureState(context: Context) {
  private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  val lastAlertSeenAt: Long? get() = prefs.getLong(KEY_SEEN, 0L).takeIf { it > 0L }
  val lastCaptureAt: Long? get() = prefs.getLong(KEY_CAPTURE, 0L).takeIf { it > 0L }

  fun markAlertSeen(at: Long) = prefs.edit().putLong(KEY_SEEN, at).apply()

  fun markCaptured(at: Long) = prefs.edit().putLong(KEY_CAPTURE, at).apply()

  private companion object {
    const val PREFS = "steadily_capture_state"
    const val KEY_SEEN = "last_alert_seen_at"
    const val KEY_CAPTURE = "last_capture_at"
  }
}
