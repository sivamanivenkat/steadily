package expo.modules.steadilycapture

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import expo.modules.steadilycapture.fastpath.CaptureSummary

/** Deep links into the app (expo-router scheme `steadily` from apps/mobile/app.json). */
object DeepLinks {
  const val REVIEW = "steadily://review"

  /** Opens [uri] in this app only. */
  fun intent(context: Context, uri: String): Intent =
    Intent(Intent.ACTION_VIEW, Uri.parse(uri))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)

  fun pending(context: Context, uri: String, requestCode: Int): PendingIntent =
    PendingIntent.getActivity(
      context,
      requestCode,
      intent(context, uri),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
}

/**
 * Posts the "Logged $12.40 at Starbucks · Coffee" confirmation right after a capture is staged.
 *
 * Shown locally only: low-importance channel, private on the lock screen, not bridged to other
 * devices. Skipped when the user turned it off, or notifications are not allowed (Android 13+
 * needs POST_NOTIFICATIONS). The text is never logged.
 */
object CaptureNotifier {
  const val CHANNEL_ID = "captures"
  const val CHANNEL_NAME = "Logged purchases"
  private const val TAG = "steadily.capture"
  private const val GROUP = "steadily.captures"
  private const val REQUEST_OPEN = 1
  private const val REQUEST_CHANGE = 2

  fun post(context: Context, captureId: String, summary: CaptureSummary) {
    if (!CaptureSettings(context).notificationsEnabled) return
    if (!canPost(context)) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    ensureChannel(manager)

    val text = CaptureText.line(summary)
    val publicVersion =
      builder(context)
        .setSmallIcon(R.drawable.steadily_capture_notification)
        .setContentTitle(CaptureText.PUBLIC_TEXT)
        .build()
    val change =
      Notification.Action.Builder(
        Icon.createWithResource(context, R.drawable.steadily_capture_notification),
        "Change",
        DeepLinks.pending(context, DeepLinks.REVIEW, REQUEST_CHANGE),
      ).build()

    val notification =
      builder(context)
        .setSmallIcon(R.drawable.steadily_capture_notification)
        .setContentTitle(text)
        .setContentIntent(DeepLinks.pending(context, DeepLinks.REVIEW, REQUEST_OPEN))
        .addAction(change)
        .setAutoCancel(true)
        .setOnlyAlertOnce(true)
        .setLocalOnly(true)
        .setShowWhen(true)
        .setGroup(GROUP)
        .setCategory(Notification.CATEGORY_STATUS)
        .setVisibility(Notification.VISIBILITY_PRIVATE)
        .setPublicVersion(publicVersion)
        .build()
    manager.notify(TAG, captureId.hashCode(), notification)
  }

  /** True when notifications may be shown: permission on Android 13+ and not blocked. */
  fun canPost(context: Context): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      return false
    }
    val manager = context.getSystemService(NotificationManager::class.java) ?: return false
    return manager.areNotificationsEnabled()
  }

  private fun ensureChannel(manager: NotificationManager) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW)
    channel.description = "A quiet confirmation each time a purchase is logged"
    channel.setShowBadge(false)
    channel.lockscreenVisibility = Notification.VISIBILITY_PRIVATE
    manager.createNotificationChannel(channel)
  }

  @Suppress("DEPRECATION")
  private fun builder(context: Context): Notification.Builder =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, CHANNEL_ID)
    } else {
      Notification.Builder(context).setPriority(Notification.PRIORITY_LOW)
    }
}
