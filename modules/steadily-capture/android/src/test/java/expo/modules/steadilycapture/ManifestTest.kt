package expo.modules.steadilycapture

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Guards the library manifest: the services the capture layer needs, and nothing more. */
class ManifestTest {
  private val manifest =
    File(TestRepo.root, "modules/steadily-capture/android/src/main/AndroidManifest.xml").readText()

  @Test
  fun declaresOnlyTheExpectedPermissions() {
    val permissions = Regex("""<uses-permission[^>]*android:name="([^"]+)"""").findAll(manifest)
      .map { it.groupValues[1] }
      .toSet()
    assertEquals(
      setOf("android.permission.WAKE_LOCK", "android.permission.POST_NOTIFICATIONS"),
      permissions,
    )
  }

  @Test
  fun declaresTheDrainServiceAndTheTile() {
    assertTrue(manifest.contains("android:name=\".CaptureDrainService\""))
    assertTrue(manifest.contains("android:name=\".LogExpenseTileService\""))
    assertTrue(manifest.contains("android.permission.BIND_QUICK_SETTINGS_TILE"))
    assertTrue(manifest.contains("android.service.quicksettings.action.QS_TILE"))
  }

  @Test
  fun headlessTaskNameIsTheAgreedOne() {
    assertEquals("SteadilyCaptureDrain", CaptureDrainService.TASK_NAME)
  }
}
