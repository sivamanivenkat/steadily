package expo.modules.steadilycapture

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS surface of the Android capture layer. Everything here is local; there is no network code. */
class SteadilyCaptureModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("SteadilyCapture")

    // Emitted when captures were staged while the app is in the foreground and JS listens.
    // Payload: { pendingCount } only, never record contents.
    Events(EVENT_PENDING_CAPTURE)

    OnStartObserving(EVENT_PENDING_CAPTURE) {
      DrainTrigger.foregroundEmitter = { count ->
        sendEvent(EVENT_PENDING_CAPTURE, mapOf("pendingCount" to count))
      }
    }

    OnStopObserving(EVENT_PENDING_CAPTURE) { DrainTrigger.foregroundEmitter = null }

    OnDestroy { DrainTrigger.foregroundEmitter = null }

    Function("isListenerEnabled") { SystemAccess.isListenerEnabled(context) }

    Function("openListenerSettings") { SystemAccess.openListenerSettings(context) }

    Function("openBatterySettings") { SystemAccess.openBatterySettings(context) }

    Function("getPendingCount") { PendingStore(context).count() }

    Function("setCaptureNotificationsEnabled") { enabled: Boolean ->
      CaptureSettings(context).notificationsEnabled = enabled
    }

    Function("getCaptureNotificationsEnabled") { CaptureSettings(context).notificationsEnabled }

    // False on Android 13+ until POST_NOTIFICATIONS is granted, or when the user blocked them.
    Function("canPostCaptureNotifications") { CaptureNotifier.canPost(context) }

    Function("getHealth") {
      val state = CaptureState(context)
      mapOf(
        "listenerEnabled" to SystemAccess.isListenerEnabled(context),
        "lastAlertSeenAt" to state.lastAlertSeenAt,
        "lastCaptureAt" to state.lastCaptureAt,
        "ignoringBatteryOptimizations" to SystemAccess.isIgnoringBatteryOptimizations(context),
        "manufacturer" to SystemAccess.manufacturer(),
        "pendingCount" to PendingStore(context).count(),
      )
    }

    // Returns the stored JSON documents, oldest first. They contain extracted fields only.
    AsyncFunction("peekPending") { limit: Int ->
      PendingStore(context).peek(limit.coerceIn(1, 200)).map { it.json }
    }

    AsyncFunction("ackPending") { ids: List<String> -> PendingStore(context).ack(ids) }
  }

  private companion object {
    const val EVENT_PENDING_CAPTURE = "onPendingCapture"
  }
}
