package expo.modules.steadilycapture.fastpath

import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import org.json.JSONObject

/**
 * The parts of a notification the fast path needs. Built by the listener and dropped right after
 * [CaptureEngine.capture] returns; never stored or logged.
 */
class NotificationSnapshot(
  val packageName: String,
  val title: String?,
  /** Expanded text if the notification has it, else the normal text. */
  val body: String?,
  val postTimeMs: Long,
)

/** A finished capture: JSON in the `PendingCapture` shape (src/schemas.ts), fields only. */
class CaptureResult(
  val id: String,
  val json: String,
  /** Hash of package and extracted fields, used only to skip duplicate re-posts of one alert. */
  val dedupeKey: String,
)

/**
 * Pure-JVM fast path: allow-list filter, then extract -> normalize -> quick categorize.
 * It has no Android dependencies so the JVM unit tests exercise exactly what ships.
 */
class CaptureEngine(
  private val packs: List<RulePack>,
  private val dictionary: MerchantDictionary,
) {
  private val normalizer = MerchantNormalizer(dictionary)

  /** Bank and payment apps named by the rule packs. Everything else is ignored immediately. */
  val bankPackages: Set<String> = packs.flatMap { it.androidPackages }.toSet()

  /** True for any package the listener should look at; false means drop without reading. */
  fun isWatched(packageName: String): Boolean =
    packageName in bankPackages || packageName in SMS_PACKAGES

  /**
   * Returns a capture for a purchase/payment alert, or null for anything else (OTPs, promos,
   * balances, declines, unrelated apps). [newId] and [nowMs] are injectable for tests.
   */
  fun capture(
    n: NotificationSnapshot,
    nowMs: Long = System.currentTimeMillis(),
    newId: () -> String = { java.util.UUID.randomUUID().toString() },
  ): CaptureResult? {
    if (!isWatched(n.packageName)) return null
    val body = n.body?.takeIf { it.isNotBlank() } ?: return null
    val title = n.title?.takeIf { it.isNotBlank() }
    val receivedAt = isoUtc(n.postTimeMs)

    val isSms = n.packageName in SMS_PACKAGES && n.packageName !in bankPackages
    // Bank apps are claimed by package. For SMS apps the title is the sender, which lets packs
    // that list SMS short codes claim the message; the rest match on brand words in the text.
    fun input(text: String) =
      if (isSms) AlertInput(text, receivedAt, smsSender = title)
      else AlertInput(text, receivedAt, source = "android_notification", androidPackage = n.packageName)

    // Some apps put the brand or the whole message in the title. Try the body alone first, then
    // "title: body"; the first rule that matches wins, exactly like the reference parser.
    val candidates = listOfNotNull(body, title?.let { "$it: $body" })
    val extracted = candidates.firstNotNullOfOrNull { FastPath.parseAlert(input(it), packs) }
      ?: return null

    val merchant = extracted.merchantRaw?.let { normalizer.normalize(it) }?.takeIf { it.name.isNotEmpty() }
    val entry = merchant?.let { dictionary.lookup(it.key) }
    val id = newId()
    return CaptureResult(id, toJson(id, nowMs, extracted, merchant, entry), dedupeKey(n.packageName, extracted))
  }

  private fun dedupeKey(pkg: String, f: ExtractedFields): String {
    val joined = listOf(pkg, f.amountMinor, f.direction, f.merchantRaw, f.accountLast4, f.txnRef).joinToString("|")
    return MessageDigest.getInstance("SHA-256").digest(joined.toByteArray(Charsets.UTF_8))
      .joinToString("") { "%02x".format(it) }
  }

  private fun toJson(
    id: String,
    nowMs: Long,
    f: ExtractedFields,
    merchant: NormalizedMerchant?,
    entry: MerchantEntry?,
  ): String {
    val extracted =
      JSONObject()
        .put("amountMinor", f.amountMinor)
        .put("currency", f.currency)
        .put("direction", f.direction)
        .put("occurredAt", f.occurredAt)
    f.merchantRaw?.let { extracted.put("merchantRaw", it) }
    f.accountLast4?.let { extracted.put("accountLast4", it) }
    f.txnRef?.let { extracted.put("txnRef", it) }
    f.issuerId?.let { extracted.put("issuerId", it) }

    val root =
      JSONObject()
        .put("v", 1)
        .put("id", id)
        .put("source", "android_notification")
        .put("capturedAt", isoUtc(nowMs))
        .put("extracted", extracted)
    merchant?.let { root.put("merchantName", it.name) }
    // Refunds and income are classified by the TypeScript categorizer, not guessed here.
    if (entry != null && f.direction == "debit") {
      root.put(
        "quickCategory",
        JSONObject()
          .put("categoryId", entry.categoryId)
          .put("confidence", if (entry.multiCategory) CONFIDENCE_MULTI else CONFIDENCE_SINGLE)
          .put("source", "dictionary"),
      )
    }
    return root.toString()
  }

  companion object {
    /** Same values as CONFIDENCE.dictionary / dictionaryMultiDefault in the TS categorizer. */
    const val CONFIDENCE_SINGLE = 0.92
    const val CONFIDENCE_MULTI = 0.6

    /** Messaging apps whose notifications are read as text messages. */
    val SMS_PACKAGES =
      setOf(
        "com.google.android.apps.messaging",
        "com.samsung.android.messaging",
        "com.android.mms",
        "com.oneplus.mms",
        "com.android.messaging",
      )

    /** Order of `BUILT_IN_PACKS` in packages/rule-packs/src/index.ts (checked by a test). */
    val BUNDLE_ORDER =
      listOf(
        "chase", "capital_one", "amex", "citi", "discover", "bank_of_america", "wells_fargo",
        "us_bank", "apple_card", "venmo", "cash_app", "zelle", "paypal", "generic",
      )

    fun isoUtc(ms: Long): String =
      SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        .apply { timeZone = TimeZone.getTimeZone("UTC") }
        .format(Date(ms))

    /** Builds an engine from the JSON of each pack (any order) and the dictionary. */
    fun fromJson(packJsons: List<String>, merchantsJson: String): CaptureEngine {
      val byId = packJsons.map { RulePack.fromJson(it) }.associateBy { it.issuerId }
      val ordered = BUNDLE_ORDER.mapNotNull { byId[it] } + byId.filterKeys { it !in BUNDLE_ORDER }.values
      return CaptureEngine(ordered, MerchantDictionary.fromJson(merchantsJson))
    }
  }
}
