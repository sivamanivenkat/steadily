package expo.modules.steadilycapture

import expo.modules.steadilycapture.fastpath.CaptureSummary
import expo.modules.steadilycapture.fastpath.NotificationSnapshot
import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptureTextTest {
  private fun summary(
    amountMinor: Long = 1240,
    merchant: String? = "Starbucks",
    categoryId: String? = "food.coffee",
    confidence: Double? = 0.92,
    direction: String = "debit",
    currency: String = "USD",
  ) = CaptureSummary(amountMinor, currency, direction, merchant, categoryId, confidence)

  @Test
  fun confidentCaptureShowsTheCategoryLabel() {
    assertEquals("Logged \$12.40 at Starbucks · Coffee", CaptureText.line(summary()))
  }

  @Test
  fun unsureOrMissingCategoryNeedsReview() {
    assertEquals("Logged \$12.40 at Target · Needs review", CaptureText.line(summary(merchant = "Target", categoryId = "shopping.general", confidence = 0.6)))
    assertEquals("Logged \$12.40 at Starbucks · Needs review", CaptureText.line(summary(categoryId = null, confidence = null)))
    assertEquals("Logged \$12.40 at Starbucks · Needs review", CaptureText.line(summary(categoryId = "custom.kids", confidence = 0.99)))
    assertEquals("Logged \$12.40 at Starbucks · Coffee", CaptureText.line(summary(confidence = CaptureText.CONFIDENT)))
  }

  @Test
  fun missingMerchantAndCreditsReadNaturally() {
    assertEquals("Logged \$12.40 · Coffee", CaptureText.line(summary(merchant = null)))
    assertEquals("Logged \$12.40 · Coffee", CaptureText.line(summary(merchant = "  ")))
    assertEquals(
      "Logged \$8.00 from Sam Example · Needs review",
      CaptureText.line(summary(amountMinor = 800, merchant = "Sam Example", categoryId = null, confidence = null, direction = "credit")),
    )
  }

  @Test
  fun amountsAreFormattedWithoutTheDeviceLocale() {
    assertEquals("\$0.05", CaptureText.formatAmount(5, "USD"))
    assertEquals("\$1,234.56", CaptureText.formatAmount(123_456, "USD"))
    assertEquals("\$1,000,000.00", CaptureText.formatAmount(100_000_000, "USD"))
    assertEquals("\$12.40", CaptureText.formatAmount(-1240, "USD"))
    assertEquals("9.99 EUR", CaptureText.formatAmount(999, "EUR"))
  }

  @Test
  fun engineSummaryMatchesTheStoredRecord() {
    val r = TestRepo.engine().capture(
      NotificationSnapshot(
        "com.chase.sig.android",
        "Chase",
        "You made a \$12.40 transaction with STARBUCKS STORE 1234 on your card ending in 4821",
        1_760_454_720_000L,
      ),
    )!!
    val json = JSONObject(r.json)
    assertEquals(json.getJSONObject("extracted").getLong("amountMinor"), r.summary.amountMinor)
    assertEquals(json.getString("merchantName"), r.summary.merchantName)
    assertEquals(json.getJSONObject("quickCategory").getString("categoryId"), r.summary.categoryId)
    assertEquals("Logged \$12.40 at Starbucks · Coffee", CaptureText.line(r.summary))
  }

  /** The Kotlin labels are a copy of packages/taxonomy; they must stay identical. */
  @Test
  fun categoryLabelsMatchTheTaxonomy() {
    val src = File(TestRepo.root, "packages/taxonomy/src/index.ts").readText()
    val block = src.substringAfter("export const CATEGORIES = [").substringBefore("] as const")
    val fromTs = Regex("""\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)'""").findAll(block)
      .map { it.groupValues[1] to it.groupValues[2] }
      .toList()
    assertTrue(fromTs.size >= 15)
    assertEquals(fromTs, CategoryLabels.BY_ID.toList())
  }

  /** Deep links must use the app's expo-router scheme and an existing route. */
  @Test
  fun reviewDeepLinkPointsAtARealRoute() {
    val appJson = JSONObject(File(TestRepo.root, "apps/mobile/app.json").readText())
    val scheme = appJson.getJSONObject("expo").getString("scheme")
    assertEquals("$scheme://review", DeepLinks.REVIEW)
    assertTrue(File(TestRepo.root, "apps/mobile/src/app/review.tsx").isFile)
  }
}
