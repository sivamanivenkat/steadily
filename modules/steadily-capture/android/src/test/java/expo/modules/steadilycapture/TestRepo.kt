package expo.modules.steadilycapture

import expo.modules.steadilycapture.fastpath.CaptureEngine
import expo.modules.steadilycapture.fastpath.RulePack
import java.io.File
import org.json.JSONArray

/** Locates the monorepo (set by build.gradle) so tests read the real packs and fixtures. */
object TestRepo {
  val root: File =
    File(System.getProperty("steadily.repoRoot") ?: error("steadily.repoRoot is not set"))

  val packsDir = File(root, "packages/rule-packs/packs")
  val fixturesDir = File(root, "packages/rule-packs/fixtures")
  val merchantsFile = File(root, "packages/merchants/data/merchants.json")

  /** Packs in the bundle order, exactly as the app loads them. */
  fun packs(): List<RulePack> =
    CaptureEngine.BUNDLE_ORDER.map { RulePack.fromJson(File(packsDir, "$it.json").readText()) }

  fun engine(): CaptureEngine =
    CaptureEngine.fromJson(
      packsDir.listFiles { f -> f.name.endsWith(".json") }!!.map { it.readText() },
      merchantsFile.readText(),
    )

  fun jsonArray(file: File): JSONArray = JSONArray(file.readText())
}
