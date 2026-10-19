package expo.modules.steadilycapture

import android.content.Context

/** User preferences for the capture layer. Holds no transaction data. */
class CaptureSettings(context: Context) {
  private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** Whether a "Logged ..." notification is posted after each capture. Defaults to on. */
  var notificationsEnabled: Boolean
    get() = prefs.getBoolean(KEY_NOTIFY, true)
    set(value) = prefs.edit().putBoolean(KEY_NOTIFY, value).apply()

  private companion object {
    const val PREFS = "steadily_capture_settings"
    const val KEY_NOTIFY = "capture_notifications_enabled"
  }
}
