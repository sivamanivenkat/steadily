package expo.modules.steadilycapture

import expo.modules.steadilycapture.fastpath.AlertInput
import expo.modules.steadilycapture.fastpath.ExtractedFields
import expo.modules.steadilycapture.fastpath.FastPath
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Runs every case of packages/rule-packs/fixtures through the Kotlin parser. These are the same
 * files the TypeScript reference (and later Swift) must pass, so a failure here means the
 * implementations disagree.
 */
class FixtureParityTest {
  private val packs = TestRepo.packs()

  private fun JSONObject.optStr(name: String): String? = if (has(name)) getString(name) else null

  private fun describe(f: ExtractedFields?): String =
    f?.let {
      "amount=${it.amountMinor} ${it.currency} ${it.direction} merchant=${it.merchantRaw} " +
        "at=${it.occurredAt} last4=${it.accountLast4} ref=${it.txnRef} issuer=${it.issuerId}"
    } ?: "null"

  private fun expected(e: JSONObject?): ExtractedFields? =
    e?.let {
      ExtractedFields(
        amountMinor = it.getLong("amountMinor"),
        currency = it.getString("currency"),
        direction = it.getString("direction"),
        merchantRaw = it.optStr("merchantRaw"),
        occurredAt = it.getString("occurredAt"),
        accountLast4 = it.optStr("accountLast4"),
        txnRef = it.optStr("txnRef"),
        issuerId = it.optStr("issuerId"),
      )
    }

  @Test
  fun everySharedFixturePasses() {
    val files = TestRepo.fixturesDir.listFiles { f -> f.name.endsWith(".json") }!!.sortedBy { it.name }
    assertTrue("no fixture files found", files.size >= 14)
    var total = 0
    val failures = ArrayList<String>()
    for (file in files) {
      val cases = TestRepo.jsonArray(file)
      for (i in 0 until cases.length()) {
        val case = cases.getJSONObject(i)
        val input = case.getJSONObject("input")
        val actual =
          FastPath.parseAlert(
            AlertInput(
              text = input.getString("text"),
              receivedAt = input.getString("receivedAt"),
              source = input.optStr("source"),
              androidPackage = input.optStr("androidPackage"),
              smsSender = input.optStr("smsSender"),
            ),
            packs,
          )
        val want = expected(case.optJSONObject("expected"))
        total++
        // Data classes compare field by field.
        if (actual != want) {
          failures.add("${file.name} / ${case.getString("name")}\n  want ${describe(want)}\n  got  ${describe(actual)}")
        }
      }
    }
    assertTrue("only $total fixture cases ran", total >= 100)
    assertEquals("fixture mismatches:\n" + failures.joinToString("\n"), 0, failures.size)
  }
}
