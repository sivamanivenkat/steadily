package expo.modules.steadilycapture

import expo.modules.steadilycapture.fastpath.MerchantDictionary
import expo.modules.steadilycapture.fastpath.MerchantNormalizer
import java.io.File
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Replays the golden file written by the TypeScript reference (src/parity.test.ts): normalized
 * name, key and dictionary category for every dictionary entry, fixture merchant and sample.
 */
class MerchantParityTest {
  @Test
  fun matchesTypeScriptNormalizer() {
    val dictionary = MerchantDictionary.fromJson(TestRepo.merchantsFile.readText())
    val normalizer = MerchantNormalizer(dictionary)
    val golden =
      JSONArray(File(javaClass.classLoader!!.getResource("merchant-golden.json")!!.toURI()).readText())
    assertTrue("golden file is unexpectedly small", golden.length() > 300)

    val failures = ArrayList<String>()
    for (i in 0 until golden.length()) {
      val c = golden.getJSONObject(i)
      val raw = c.getString("raw")
      val n = normalizer.normalize(raw)
      val entry = dictionary.lookup(n.key)
      val got = listOf(n.name, n.key, entry?.categoryId, entry?.multiCategory == true)
      val want = listOf(
        c.getString("name"),
        c.getString("key"),
        if (c.isNull("categoryId")) null else c.getString("categoryId"),
        c.getBoolean("multi"),
      )
      if (got != want) failures.add("'$raw': want $want got $got")
    }
    assertEquals("normalizer mismatches:\n" + failures.joinToString("\n"), 0, failures.size)
  }

  @Test
  fun toMerchantKeyDropsApostrophesAndAccents() {
    assertEquals("trader_joes", MerchantNormalizer.toMerchantKey("Trader Joe's"))
    assertEquals("att", MerchantNormalizer.toMerchantKey("AT&T"))
    assertEquals("cafe_rio", MerchantNormalizer.toMerchantKey("  Café  Rio "))
  }
}
