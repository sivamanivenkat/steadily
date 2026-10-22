package expo.modules.steadilycapture

import android.app.PendingIntent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * Quick Settings tile "Log expense". A tap opens the app's Add screen (`steadily://add`) so the
 * user can add an expense by hand.
 */
class LogExpenseTileService : TileService() {
  override fun onStartListening() {
    super.onStartListening()
    qsTile?.let { tile ->
      // An action tile, not a toggle: always shown as available.
      tile.state = Tile.STATE_INACTIVE
      tile.updateTile()
    }
  }

  override fun onClick() {
    super.onClick()
    if (isLocked) unlockAndRun { open() } else open()
  }

  private fun open() {
    val intent = DeepLinks.intent(this, DeepLinks.ADD)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        startActivityAndCollapse(
          PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE),
        )
      } else {
        @Suppress("DEPRECATION")
        startActivityAndCollapse(intent)
      }
    } catch (_: Exception) {
      // Nothing to report: the tile simply does not open the app.
    }
  }
}
