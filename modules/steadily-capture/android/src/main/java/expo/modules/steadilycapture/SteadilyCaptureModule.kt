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

    Function("isListenerEnabled") { SystemAccess.isListenerEnabled(context) }

    Function("openListenerSettings") { SystemAccess.openListenerSettings(context) }

    Function("openBatterySettings") { SystemAccess.openBatterySettings(context) }

    Function("getPendingCount") { PendingStore(context).count() }

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
}
