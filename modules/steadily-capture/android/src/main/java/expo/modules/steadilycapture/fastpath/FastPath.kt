package expo.modules.steadilycapture.fastpath

/** An alert as the capture surface sees it. Mirrors `AlertInput` in the rule-packs package. */
data class AlertInput(
  val text: String,
  /** ISO 8601 timestamp with offset, copied into `occurredAt`. */
  val receivedAt: String,
  val source: String? = null,
  val androidPackage: String? = null,
  val smsSender: String? = null,
)

/** Mirrors `ExtractedFields` in packages/shared-types. Money is integer minor units. */
data class ExtractedFields(
  val amountMinor: Long,
  val currency: String,
  /** "debit" or "credit". */
  val direction: String,
  val merchantRaw: String?,
  val occurredAt: String,
  val accountLast4: String?,
  val txnRef: String?,
  val issuerId: String?,
)

/**
 * Kotlin port of the reference interpreter in packages/rule-packs/src/parse.ts, following the
 * algorithm in packages/rule-packs/README.md step by step. Both must agree on every fixture in
 * packages/rule-packs/fixtures (see FixtureParityTest).
 *
 * Alert text is only ever held in local variables here: it is never logged, stored or returned.
 */
object FastPath {
  private val CREDIT_WORDS =
    listOf("refund", "credit", "deposit", "received", "return", "paid you", "sent you")
  private val DEBIT_WORDS =
    listOf("purchase", "debit", "charge", "withdrawal", "spent", "paid", "sent")
  private val AMOUNT_SHAPE = Regex("^([0-9]+)(?:\\.([0-9]{1,2}))?$")
  private const val MAX_SAFE_INTEGER = 9007199254740991L

  /** JavaScript's `\s` set plus U+2007 and U+202F (already inside \s, listed in the README). */
  internal fun isJsSpace(c: Char): Boolean =
    when (c) {
      '\t', '\n', '\u000B', '\u000C', '\r', ' ', ' ', ' ', ' ', ' ',
      ' ', ' ', '　', '﻿' -> true
      else -> c in ' '..' '
    }

  /** Collapses every run of whitespace to one ASCII space, no trimming. */
  internal fun collapseSpaces(text: String): String {
    val out = StringBuilder(text.length)
    var inRun = false
    for (c in text) {
      if (isJsSpace(c)) {
        if (!inRun) out.append(' ')
        inRun = true
      } else {
        out.append(c)
        inRun = false
      }
    }
    return out.toString()
  }

  internal fun jsTrim(text: String): String = text.trim { isJsSpace(it) }

  /** Step 1: whitespace runs become one space, then trim. */
  fun normalizeAlertText(text: String): String = jsTrim(collapseSpaces(text))

  /** "$1,234.56" | "USD 12.30" | "$5" -> integer cents, or null if malformed. */
  fun parseAmountToMinor(raw: String): Long? {
    val cleaned =
      raw.replace(Regex("USD", RegexOption.IGNORE_CASE), "").filter { it != '$' && it != ',' && !isJsSpace(it) }
    val m = AMOUNT_SHAPE.matchEntire(cleaned) ?: return null
    val dollarDigits = m.groupValues[1]
    // More than 16 digits can never be a safe integer once multiplied by 100.
    if (dollarDigits.length > 16) return null
    val dollars = dollarDigits.toLong()
    val cents = m.groupValues[2].padEnd(2, '0').let { if (it.isEmpty()) 0L else it.toLong() }
    if (dollars > (MAX_SAFE_INTEGER - cents) / 100) return null
    return dollars * 100 + cents
  }

  /** Trim, collapse whitespace, drop trailing punctuation, cap at 200 characters. */
  fun cleanMerchant(raw: String): String? {
    var s = jsTrim(collapseSpaces(raw))
    s = s.trimEnd { isJsSpace(it) || it in ".,;:!" }
    if (s.length > 200) s = s.substring(0, 200)
    s = jsTrim(s)
    return s.ifEmpty { null }
  }

  /** Maps a captured `direction` group to debit/credit; credit words win. */
  fun directionFromText(captured: String, fallback: String): String {
    val t = captured.lowercase()
    if (CREDIT_WORDS.any { t.contains(it) }) return "credit"
    if (DEBIT_WORDS.any { t.contains(it) }) return "debit"
    return fallback
  }

  private fun channelOf(input: AlertInput): String? =
    when {
      !input.androidPackage.isNullOrEmpty() || input.source == "android_notification" -> "push"
      !input.smsSender.isNullOrEmpty() || input.source == "ios_sms_shortcut" -> "sms"
      else -> null
    }

  private fun claims(pack: RulePack, input: AlertInput): Boolean {
    if (!input.androidPackage.isNullOrEmpty() && pack.androidPackages.contains(input.androidPackage)) {
      return true
    }
    val sender = input.smsSender?.let { jsTrim(it).lowercase() }
    return !sender.isNullOrEmpty() && pack.smsSenders.any { it.lowercase() == sender }
  }

  /** Returns the fields of the first matching rule, or null (not a transaction alert). */
  fun parseAlert(input: AlertInput, packs: List<RulePack>): ExtractedFields? {
    val text = normalizeAlertText(input.text)
    if (text.isEmpty()) return null

    val channel = channelOf(input)
    val specific = packs.filter { !it.isGeneric }
    val generic = packs.filter { it.isGeneric }
    val claimed = specific.filter { claims(it, input) }
    val bySource = claimed.isNotEmpty()
    val ordered = (if (bySource) claimed else specific) + generic

    for (pack in ordered) {
      if (pack.exclude.any { it.matcher(text).find() }) continue
      for (rule in pack.rules) {
        if (rule.channel != "any" && rule.channel != channel) continue
        // Push rules are brand-agnostic, so they only run for the app that posted the alert.
        if (rule.channel == "push" && !bySource) continue

        val matcher = rule.pattern.matcher(text)
        if (!matcher.find()) continue
        fun group(name: String): String? =
          if (name in rule.groupNames) matcher.group(name)?.takeIf { it.isNotEmpty() } else null

        val amountMinor = group("amount")?.let { parseAmountToMinor(it) } ?: continue
        val merchantRaw = group("merchant")?.let { cleanMerchant(it) }
        val last4 = group("last4")?.takeIf { l -> l.length == 4 && l.all { it in '0'..'9' } }
        val txnRef = group("txnRef")?.let { jsTrim(it).take(100) }?.ifEmpty { null }
        val direction =
          group("direction")?.let { directionFromText(it, rule.direction) } ?: rule.direction

        return ExtractedFields(
          amountMinor = amountMinor,
          currency = "USD",
          direction = direction,
          merchantRaw = merchantRaw,
          occurredAt = input.receivedAt,
          accountLast4 = last4,
          txnRef = txnRef,
          issuerId = if (pack.isGeneric) null else pack.issuerId,
        )
      }
    }
    return null
  }
}
