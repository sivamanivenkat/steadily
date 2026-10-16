package expo.modules.steadilycapture.fastpath

import java.text.Normalizer
import org.json.JSONObject

/** One merchant dictionary entry (packages/merchants/data/merchants.json). */
class MerchantEntry(
  val key: String,
  val name: String,
  val categoryId: String,
  val multiCategory: Boolean,
)

class NormalizedMerchant(val name: String, val key: String)

/** Dictionary lookup by key or alias. Mirrors `lookupMerchant` in packages/merchants. */
class MerchantDictionary(private val byKey: Map<String, MerchantEntry>) {
  fun lookup(key: String): MerchantEntry? = byKey[key]

  companion object {
    fun fromJson(json: String): MerchantDictionary {
      val list = JSONObject(json).getJSONArray("merchants")
      val map = HashMap<String, MerchantEntry>()
      for (i in 0 until list.length()) {
        val o = list.getJSONObject(i)
        val entry =
          MerchantEntry(
            key = o.getString("key"),
            name = o.getString("name"),
            categoryId = o.getString("categoryId"),
            multiCategory = o.optBoolean("multiCategory", false),
          )
        map[entry.key] = entry
        o.optJSONArray("aliases")?.let { a ->
          for (j in 0 until a.length()) map[a.getString(j)] = entry
        }
      }
      return MerchantDictionary(map)
    }
  }
}

/**
 * Kotlin port of packages/merchants/src/normalize.ts. The golden test (MerchantParityTest)
 * compares it with the TypeScript output for every dictionary name and every fixture merchant.
 */
class MerchantNormalizer(private val dictionary: MerchantDictionary) {
  fun normalize(raw: String): NormalizedMerchant {
    var s = FastPath.jsTrim(FastPath.collapseSpaces(Normalizer.normalize(raw, Normalizer.Form.NFKC).uppercase()))
    if (s.isEmpty()) return NormalizedMerchant("", "")

    for ((re, replacement) in CANONICAL) {
      if (re.containsMatchIn(s)) {
        s = replacement
        break
      }
    }

    for (i in 0 until 3) {
      val m = PROCESSOR_PREFIX.find(s) ?: break
      if (m.value.length >= s.length) break
      s = s.substring(m.value.length)
    }

    s = s.replace(REFERENCE_CODE, " ")
      .replace("*", " ")
      .replace(PHONE, " ")
      .replace(WWW, "")
      .replace(DOMAIN, "")
      .replace("#", " #")
      .replace(PUNCT, " ")
    s = FastPath.jsTrim(FastPath.collapseSpaces(s))

    var tokens = s.split(' ').filter { it.isNotEmpty() }
    val cut = tokens.indices.firstOrNull { i -> i > 0 && isStoreNumber(tokens[i], tokens.getOrNull(i + 1)) } ?: -1
    if (cut > 0) tokens = tokens.subList(0, cut)
    while (tokens.size > 1 && tokens.last() in CORPORATE_SUFFIX) tokens = tokens.dropLast(1)

    dictionaryPrefix(tokens)?.let { return NormalizedMerchant(it.name, it.key) }

    tokens = stripCityState(tokens)
    tokens = tokens.map { it.replace(EDGE_DASH, "") }.filter { it.isNotEmpty() }
    if (tokens.isEmpty()) {
      tokens = FastPath.jsTrim(FastPath.collapseSpaces(raw.uppercase())).split(' ')
    }

    val name = titleCase(tokens)
    return NormalizedMerchant(name, toMerchantKey(name))
  }

  private fun dictionaryPrefix(tokens: List<String>): MerchantEntry? {
    for (n in tokens.size downTo 1) {
      dictionary.lookup(toMerchantKey(tokens.subList(0, n).joinToString(" ")))?.let { return it }
    }
    return null
  }

  private fun isStoreNumber(token: String, next: String?): Boolean {
    if (token.startsWith("#")) return true
    if (THREE_DIGITS.matches(token)) return true
    if (LETTER_DIGITS.matches(token)) return true
    return STORE_WORD.matches(token) && next != null && NUMBER_REF.matches(next)
  }

  private fun stripCityState(tokens: List<String>): List<String> {
    val last = tokens.lastOrNull() ?: return tokens
    if (last !in US_STATES) return tokens
    val body = tokens.dropLast(1)
    for (city in MULTI_WORD_CITIES) {
      if (body.size > city.size && body.takeLast(city.size) == city) return body.dropLast(city.size)
    }
    val minTokens = if (last in AMBIGUOUS_STATES) 4 else 3
    return if (tokens.size >= minTokens) body.dropLast(1) else tokens
  }

  private fun titleCaseWord(word: String, index: Int): String {
    val lower = word.lowercase()
    if (index > 0 && lower in SMALL_WORDS) return lower
    if (word.contains('&') && word.length <= 5) return word
    val letters = word.filter { it in 'A'..'Z' }
    if (letters.length in 2..4 && !VOWELS.containsMatchIn(letters)) return word
    return WORD_START.replace(lower) { m -> m.groupValues[1] + m.groupValues[2].uppercase() }
  }

  private fun titleCase(tokens: List<String>): String {
    val merged = ArrayList<String>()
    for (t in tokens) {
      // Processors often drop apostrophes: "JOE S" -> "Joe's".
      if (t == "S" && merged.isNotEmpty()) merged[merged.size - 1] = merged.last() + "'S"
      else merged.add(t)
    }
    return merged.mapIndexed { i, w -> titleCaseWord(w, i) }.joinToString(" ")
  }

  companion object {
    /** "Trader Joe's" -> "trader_joes", "AT&T" -> "att", "7-Eleven" -> "7_eleven". */
    fun toMerchantKey(name: String): String =
      Normalizer.normalize(name.lowercase(), Normalizer.Form.NFKD)
        .replace(COMBINING_MARKS, "")
        .replace(DROPPED_CHARS, "")
        .replace(NON_ALNUM, "_")
        .trim('_')

    private val COMBINING_MARKS = Regex("[\\u0300-\\u036f]")
    private val DROPPED_CHARS = Regex("['\\u2019.&+]")
    private val NON_ALNUM = Regex("[^a-z0-9]+")

    private val CANONICAL: List<Pair<Regex, String>> =
      listOf(
        Regex("^(?:AMAZON PRIME|PRIME VIDEO)(?:[\\s*].*)?$") to "AMAZON PRIME",
        Regex(
          "^(?:AMZN MKTP(?: US)?|AMZN\\.COM|AMZN DIGITAL|AMZN|AMAZON MKTPL(?:ACE)?|AMAZON MARKETPLACE|AMAZON\\.COM|AMAZON RETA)(?:[\\s*/].*)?$",
        ) to "AMAZON",
        Regex("^UBER\\s*\\*?\\s*EATS\\b.*$") to "UBER EATS",
        Regex("^UBER(?:\\s*\\*\\s*|\\s+)(?:TRIP|PENDING|RIDES?)\\b.*$") to "UBER",
        Regex("^LYFT\\s*\\*.*$") to "LYFT",
        Regex("^APPLE\\.?COM[\\s/]+BILL\\b.*$") to "APPLE SERVICES",
        Regex("^UNITED(?:\\s+AIR\\s*LINES?)?\\s+[0-9]{10,}\\b.*$") to "UNITED AIRLINES",
        Regex("^DELTA(?:\\s+AIR\\s*LINES?)?\\s+[0-9]{10,}\\b.*$") to "DELTA AIR LINES",
        Regex("^AMERICAN(?:\\s+AIR\\s*LINES?)?\\s+[0-9]{10,}\\b.*$") to "AMERICAN AIRLINES",
        Regex("^SOUTHWEST(?:\\s+AIR\\s*LINES?)?\\s+[0-9]{10,}\\b.*$") to "SOUTHWEST AIRLINES",
        Regex("^JET\\s*BLUE\\s+[0-9]{10,}\\b.*$") to "JETBLUE",
      )

    private val PROCESSOR_PREFIX = Regex("^(?:SQ|TST|PAYPAL|PP|SP|DD|DOORDASH|GOOGLE)\\s*\\*\\s*")
    private val REFERENCE_CODE = Regex("\\*\\s*[A-Z0-9]*[0-9][A-Z0-9]*\\b")
    private val PHONE = Regex("\\b1?-?[0-9]{3}[-. ][0-9]{3}[-. ][0-9]{4}\\b")
    private val WWW = Regex("^WWW\\.")
    private val DOMAIN = Regex("\\.(?:COM|NET|ORG)(?:/\\S*)?\\b")
    private val PUNCT = Regex("[,;:\"]")
    private val EDGE_DASH = Regex("^[-.]+|[-.]+$")
    private val THREE_DIGITS = Regex("^[0-9]{3,}$")
    private val LETTER_DIGITS = Regex("^[A-Z]-?[0-9]{3,}$")
    private val STORE_WORD = Regex("^(?:STORE|STR|STO|NO|UNIT)$")
    private val NUMBER_REF = Regex("^#?[0-9]+$")
    private val VOWELS = Regex("[AEIOUY]")
    private val WORD_START = Regex("(^|[\\s\\-/.&(])([a-z])")

    private val US_STATES =
      ("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH " +
          "NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY")
        .split(' ')
        .toSet()
    private val AMBIGUOUS_STATES =
      setOf("CO", "IN", "OR", "ME", "OK", "HI", "DE", "LA", "MA", "AL", "PA", "ID", "OH")
    private val MULTI_WORD_CITIES: List<List<String>> =
      listOf(
          "SAN FRANCISCO", "SOUTH SAN FRANCISCO", "NEW YORK", "LOS ANGELES", "SAN DIEGO",
          "SAN JOSE", "SAN ANTONIO", "LAS VEGAS", "SALT LAKE CITY", "ST LOUIS", "SAINT LOUIS",
          "KANSAS CITY", "NEW ORLEANS", "FORT WORTH", "EL PASO", "OKLAHOMA CITY", "LONG BEACH",
          "VIRGINIA BEACH", "COLORADO SPRINGS", "BATON ROUGE", "SANTA MONICA", "SANTA CLARA",
          "PALO ALTO", "MOUNTAIN VIEW", "JERSEY CITY", "WASHINGTON DC",
        )
        .map { it.split(' ') }
    private val CORPORATE_SUFFIX = setOf("INC", "LLC", "CORP", "LTD", "CO.", "INC.", "L.L.C.")
    private val SMALL_WORDS = setOf("and", "of", "the", "in", "at", "for", "on", "a")
  }
}
