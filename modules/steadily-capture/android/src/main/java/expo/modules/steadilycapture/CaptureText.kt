package expo.modules.steadilycapture

import expo.modules.steadilycapture.fastpath.CaptureSummary

/** Display names of the built-in categories. Must match packages/taxonomy (checked by tests). */
object CategoryLabels {
  val BY_ID: Map<String, String> =
    linkedMapOf(
      "food.groceries" to "Groceries",
      "food.dining" to "Dining Out",
      "food.coffee" to "Coffee",
      "transport.general" to "Transport",
      "transport.gas" to "Gas",
      "shopping.general" to "Shopping",
      "bills.utilities" to "Bills & Utilities",
      "housing.rent_mortgage" to "Rent & Mortgage",
      "subscriptions.general" to "Subscriptions",
      "health.general" to "Health",
      "entertainment.general" to "Entertainment",
      "travel.general" to "Travel",
      "personal_care.general" to "Personal Care",
      "gifts.general" to "Gifts & Giving",
      "other.general" to "Other",
    )
}

/** Pure text for the confirmation notification, e.g. "Logged $12.40 at Starbucks · Coffee". */
object CaptureText {
  /** Same bar as the categorizer's auto-save threshold (D-020). */
  const val CONFIDENT = 0.85
  const val NEEDS_REVIEW = "Needs review"
  /** Shown on the lock screen instead of the details. */
  const val PUBLIC_TEXT = "Transaction logged"

  fun line(s: CaptureSummary): String {
    val amount = formatAmount(s.amountMinor, s.currency)
    val preposition = if (s.direction == "credit") "from" else "at"
    val merchant = s.merchantName?.trim()?.takeIf { it.isNotEmpty() }?.let { " $preposition $it" }.orEmpty()
    return "Logged $amount$merchant · ${categoryPart(s)}"
  }

  /** The category label when the quick category is confident, else "Needs review". */
  fun categoryPart(s: CaptureSummary): String {
    val id = s.categoryId ?: return NEEDS_REVIEW
    val confidence = s.confidence ?: return NEEDS_REVIEW
    if (confidence < CONFIDENT) return NEEDS_REVIEW
    return CategoryLabels.BY_ID[id] ?: NEEDS_REVIEW
  }

  /** "$1,234.56" for USD; "1,234.56 EUR" for other codes. Locale independent on purpose. */
  fun formatAmount(amountMinor: Long, currency: String): String {
    val abs = if (amountMinor < 0) -amountMinor else amountMinor
    val whole = (abs / 100).toString().reversed().chunked(3).joinToString(",").reversed()
    val cents = (abs % 100).toString().padStart(2, '0')
    val number = "$whole.$cents"
    return if (currency == "USD") "\$$number" else "$number $currency"
  }
}
