package expo.modules.steadilycapture.fastpath

import java.util.regex.Pattern
import org.json.JSONArray
import org.json.JSONObject

/** One rule of a pack. The regex is compiled once. */
class Rule(
  val id: String,
  /** "push", "sms" or "any". */
  val channel: String,
  val pattern: Pattern,
  /** Named groups present in the pattern. Reading an absent group would throw in Java. */
  val groupNames: Set<String>,
  /** Default direction, "debit" or "credit". */
  val direction: String,
)

/** Mirrors `RulePack` in packages/rule-packs/src/schema.ts. Pure JVM, no Android classes. */
class RulePack(
  val issuerId: String,
  val androidPackages: List<String>,
  val smsSenders: List<String>,
  val exclude: List<Pattern>,
  val rules: List<Rule>,
) {
  val isGeneric: Boolean get() = issuerId == GENERIC_ISSUER_ID

  companion object {
    const val GENERIC_ISSUER_ID = "generic"

    /**
     * Same flags as the TypeScript reference (`new RegExp(p, 'i')`): case-insensitive, and only
     * "\n" ends a line so `.` behaves like JavaScript's.
     */
    fun compile(pattern: String): Pattern =
      Pattern.compile(pattern, Pattern.CASE_INSENSITIVE or Pattern.UNIX_LINES)

    private val GROUP_NAME = Regex("\\(\\?<([A-Za-z][A-Za-z0-9]*)>")

    fun fromJson(json: String): RulePack {
      val root = JSONObject(json)
      val sources = root.getJSONObject("sources")
      val rules = root.getJSONArray("rules").objects().map { r ->
        val source = r.getString("pattern")
        Rule(
          id = r.getString("id"),
          channel = r.getString("channel"),
          pattern = compile(source),
          groupNames = GROUP_NAME.findAll(source).map { it.groupValues[1] }.toSet(),
          direction = r.getString("direction"),
        )
      }
      return RulePack(
        issuerId = root.getString("issuerId"),
        androidPackages = sources.getJSONArray("androidPackages").strings(),
        smsSenders = sources.getJSONArray("smsSenders").strings(),
        exclude = root.optJSONArray("exclude")?.strings()?.map { compile(it) } ?: emptyList(),
        rules = rules,
      )
    }

    private fun JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }

    private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
  }
}
