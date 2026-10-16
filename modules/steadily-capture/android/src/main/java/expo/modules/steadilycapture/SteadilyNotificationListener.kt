package expo.modules.steadilycapture

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/** Notification access entry point. Capture logic is added in the next step. */
class SteadilyNotificationListener : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    // Ignored for now: nothing is read or stored.
  }
}
