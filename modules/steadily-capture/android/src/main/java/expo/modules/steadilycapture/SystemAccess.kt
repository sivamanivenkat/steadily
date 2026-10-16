package expo.modules.steadilycapture

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings

/** Reads and opens system settings that capture depends on. Holds no user data. */
object SystemAccess {
  /** True when the user enabled notification access for this app. */
  fun isListenerEnabled(context: Context): Boolean {
    val flat = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
      ?: return false
    return flat.split(':').any { entry ->
      ComponentName.unflattenFromString(entry)?.packageName == context.packageName
    }
  }

  fun isIgnoringBatteryOptimizations(context: Context): Boolean {
    val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
    return power.isIgnoringBatteryOptimizations(context.packageName)
  }

  fun manufacturer(): String = Build.MANUFACTURER.orEmpty().lowercase()

  /** Notification access list. On Android 13+ sideloaded builds may need "Allow restricted settings". */
  fun openListenerSettings(context: Context): Boolean =
    start(context, Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))

  /**
   * The battery optimization list, or this app's info page if the list is unavailable. Uses no
   * special permission (the direct exemption prompt is restricted on Google Play).
   */
  fun openBatterySettings(context: Context): Boolean =
    start(context, Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) ||
      start(
        context,
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")),
      )

  private fun start(context: Context, intent: Intent): Boolean =
    try {
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (_: Exception) {
      false
    }
}
