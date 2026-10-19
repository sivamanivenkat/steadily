package expo.modules.steadilycapture

import android.app.Notification
import android.content.Context
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import expo.modules.steadilycapture.fastpath.CaptureEngine
import expo.modules.steadilycapture.fastpath.NotificationSnapshot

/**
 * Reads bank and payment notifications and stages the extracted fields.
 *
 * Privacy rules (D-011), enforced here:
 * - Packages outside the allow-list are dropped before any content is read.
 * - Title and text live only in local variables of [handle]; nothing about them is logged,
 *   stored or put in an exception message. Failures are swallowed silently on purpose.
 * - Only the fields the rule packs extract are written, sealed by [PendingStore].
 * - No network code exists in this module.
 */
class SteadilyNotificationListener : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    try {
      handle(sbn)
    } catch (_: Exception) {
      // Never log: the exception could carry notification text.
    }
  }

  private fun handle(sbn: StatusBarNotification) {
    val packageName = sbn.packageName ?: return
    if (packageName == applicationContext.packageName) return

    val engine = EngineHolder.get(applicationContext)
    if (!engine.isWatched(packageName)) return

    val notification = sbn.notification ?: return
    if (notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return

    val state = CaptureState(applicationContext)
    state.markAlertSeen(System.currentTimeMillis())

    val extras = notification.extras ?: return
    val snapshot =
      NotificationSnapshot(
        packageName = packageName,
        title = (extras.getCharSequence(Notification.EXTRA_TITLE_BIG)
          ?: extras.getCharSequence(Notification.EXTRA_TITLE))?.toString(),
        body = bodyOf(extras),
        postTimeMs = sbn.postTime,
      )
    val result = engine.capture(snapshot) ?: return
    if (!RecentAlerts.firstTime(result.dedupeKey, System.currentTimeMillis())) return

    PendingStore(applicationContext).put(result.id, result.json)
    state.markCaptured(System.currentTimeMillis())
    DrainTrigger.onStaged(applicationContext)
  }

  /** Expanded text, else normal text, else the newest message of a messaging-style alert. */
  private fun bodyOf(extras: Bundle): String? {
    (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))
      ?.toString()
      ?.takeIf { it.isNotBlank() }
      ?.let { return it }
    @Suppress("DEPRECATION") val raw = extras.getParcelableArray(Notification.EXTRA_MESSAGES)
    val bundles = raw?.filterIsInstance<Bundle>()?.toTypedArray() ?: return null
    return Notification.MessagingStyle.Message.getMessagesFromBundleArray(bundles)
      .lastOrNull()
      ?.text
      ?.toString()
  }
}

/** Loads the shared rule packs and merchant dictionary from the APK assets, once per process. */
object EngineHolder {
  @Volatile private var engine: CaptureEngine? = null

  fun get(context: Context): CaptureEngine =
    engine ?: synchronized(this) {
      engine ?: load(context).also { engine = it }
    }

  private fun load(context: Context): CaptureEngine {
    val assets = context.assets
    val packs = (assets.list("steadily/packs") ?: emptyArray())
      .filter { it.endsWith(".json") }
      .map { name -> assets.open("steadily/packs/$name").bufferedReader().use { it.readText() } }
    val merchants = assets.open("steadily/merchants.json").bufferedReader().use { it.readText() }
    return CaptureEngine.fromJson(packs, merchants)
  }
}

/** Skips an alert that the posting app re-posted (updates, group refreshes) within a minute. */
object RecentAlerts {
  private const val WINDOW_MS = 60 * 1000L
  private const val MAX_ENTRIES = 64
  private val seen = LinkedHashMap<String, Long>()

  @Synchronized
  fun firstTime(key: String, now: Long): Boolean {
    seen.entries.removeAll { now - it.value > WINDOW_MS }
    if (seen.containsKey(key)) return false
    seen[key] = now
    while (seen.size > MAX_ENTRIES) seen.remove(seen.keys.first())
    return true
  }
}
