package expo.modules.steadilycapture

import expo.modules.steadilycapture.fastpath.CaptureEngine
import expo.modules.steadilycapture.fastpath.NotificationSnapshot
import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptureEngineTest {
  private val engine = TestRepo.engine()
  private val postTime = 1_760_454_720_000L // 2025-10-14T15:12:00Z, synthetic

  private fun snap(pkg: String, title: String?, body: String?) =
    NotificationSnapshot(pkg, title, body, postTime)

  private fun capture(s: NotificationSnapshot) =
    engine.capture(s, nowMs = postTime + 1000, newId = { "3f2b8c1e-5a41-4d7e-9c3a-1b2c3d4e5f60" })

  @Test
  fun allowListComesFromTheRulePacks() {
    assertTrue(engine.isWatched("com.chase.sig.android"))
    assertTrue(engine.isWatched("com.venmo"))
    assertTrue(engine.isWatched("com.google.android.apps.messaging"))
    assertFalse(engine.isWatched("com.example.game"))
    assertTrue(engine.bankPackages.containsAll(setOf("com.squareup.cash", "com.infonow.bofa")))
  }

  @Test
  fun unrelatedAppsAreIgnoredWithoutParsing() {
    assertNull(capture(snap("com.example.game", "Sale", "You spent \$5.00 at STARBUCKS")))
  }

  @Test
  fun bankPurchaseBecomesAFieldsOnlyRecord() {
    val r = capture(
      snap(
        "com.chase.sig.android",
        "Chase Sapphire",
        "You made a \$25.40 transaction with STARBUCKS STORE 1234 on your card ending in 4821",
      ),
    )
    assertNotNull(r)
    val json = JSONObject(r!!.json)
    assertEquals(1, json.getInt("v"))
    assertEquals("android_notification", json.getString("source"))
    assertEquals("Starbucks", json.getString("merchantName"))
    val extracted = json.getJSONObject("extracted")
    assertEquals(2540, extracted.getLong("amountMinor"))
    assertEquals("debit", extracted.getString("direction"))
    assertEquals("2025-10-14T15:12:00.000Z", extracted.getString("occurredAt"))
    assertEquals("4821", extracted.getString("accountLast4"))
    assertEquals("chase", extracted.getString("issuerId"))
    val q = json.getJSONObject("quickCategory")
    assertEquals("food.coffee", q.getString("categoryId"))
    assertEquals(0.92, q.getDouble("confidence"), 1e-9)
    assertEquals("dictionary", q.getString("source"))
  }

  @Test
  fun storedRecordNeverContainsTheAlertText() {
    val body = "You made a \$25.40 transaction with STARBUCKS STORE 1234 on your card ending in 4821"
    val r = capture(snap("com.chase.sig.android", "Chase Sapphire", body))!!
    assertFalse(r.json.contains("You made"))
    assertFalse(r.json.contains("Chase Sapphire"))
    assertFalse(r.json.contains("transaction with"))
  }

  @Test
  fun multiCategoryMerchantGetsLowConfidenceAndCreditsGetNone() {
    val purchase = capture(snap("com.chase.sig.android", null, "You made a \$12.00 transaction with TARGET 00012345"))!!
    assertEquals(0.6, JSONObject(purchase.json).getJSONObject("quickCategory").getDouble("confidence"), 1e-9)
    val refund = capture(snap("com.chase.sig.android", "Chase", "You have a \$18.99 refund from TARGET 00012345."))!!
    val refundJson = JSONObject(refund.json)
    assertEquals("credit", refundJson.getJSONObject("extracted").getString("direction"))
    assertFalse(refundJson.has("quickCategory"))
  }

  @Test
  fun nonTransactionAlertsYieldNothing() {
    assertNull(capture(snap("com.chase.sig.android", "Chase", "Your one-time code is 482913. Don't share it.")))
    assertNull(capture(snap("com.chase.sig.android", "Chase", "Get 10% cash back on your next purchase.")))
    assertNull(capture(snap("com.chase.sig.android", "Chase", null)))
    assertNull(capture(snap("com.chase.sig.android", null, "   ")))
  }

  @Test
  fun smsFromABankIsParsedByBrandWords() {
    val r = capture(
      snap(
        "com.google.android.apps.messaging",
        "CHASE",
        "Chase Freedom (...4821): You made a \$7.10 transaction with CHIPOTLE 1234.",
      ),
    )
    assertNotNull(r)
    val extracted = JSONObject(r!!.json).getJSONObject("extracted")
    assertEquals(710, extracted.getLong("amountMinor"))
    assertEquals("chase", extracted.getString("issuerId"))
  }

  @Test
  fun titleIsUsedWhenTheBodyAloneDoesNotMatch() {
    val r = capture(
      snap(
        "com.chase.sig.android",
        "Chase Freedom (...4821)",
        "You made a \$7.10 transaction with CHIPOTLE 1234.",
      ),
    )
    assertNotNull(r)
    assertEquals(710, JSONObject(r!!.json).getJSONObject("extracted").getLong("amountMinor"))
  }

  @Test
  fun dedupeKeyIsStableAcrossRepostsAndIgnoresText() {
    val a = capture(snap("com.chase.sig.android", "Chase", "You made a \$5.00 transaction with BLUE BOTTLE COFFEE"))!!
    val b = engine.capture(
      snap("com.chase.sig.android", "Chase", "You made a \$5.00 transaction with BLUE BOTTLE COFFEE"),
      nowMs = postTime + 90_000,
    )!!
    assertEquals(a.dedupeKey, b.dedupeKey)
    assertEquals(64, a.dedupeKey.length)
    assertTrue(a.id != b.id)
  }

  @Test
  fun recordFitsTheTypeScriptSchemaShape() {
    val r = capture(snap("com.venmo", "Venmo", "Sam Example paid you \$8.00"))!!
    val json = JSONObject(r.json)
    assertEquals(setOf("v", "id", "source", "capturedAt", "extracted"), json.keys().asSequence().toSet() - setOf("merchantName", "quickCategory"))
    assertTrue(Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$").matches(json.getString("capturedAt")))
  }

  /** The module must stay offline and quiet: no INTERNET permission, no network or log calls. */
  @Test
  fun moduleHasNoNetworkOrLoggingCode() {
    val main = File(TestRepo.root, "modules/steadily-capture/android/src/main")
    val manifest = File(main, "AndroidManifest.xml").readText()
    assertFalse(Regex("<uses-permission[^>]*INTERNET").containsMatchIn(manifest))
    val banned = listOf("android.util.Log", "java.net.", "okhttp", "HttpURLConnection", "println(", "Timber", "java.util.logging")
    val offenders = main.walkTopDown().filter { it.extension == "kt" }.flatMap { f ->
      banned.filter { f.readText().contains(it) }.map { "${f.name}: $it" }
    }.toList()
    assertEquals(emptyList<String>(), offenders)
  }
}
