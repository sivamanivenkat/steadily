# Eval data

## `categorize.synthetic.json` (committed)

Synthetic labeled spending transactions for the categorizer eval. Every descriptor is made up
or a generic chain-store pattern (`SQ *`, `TST*`, store numbers); people are placeholders such as
"Sam Example". Each item:

```jsonc
{
  "id": "syn-001", // unique
  "merchantRaw": "KROGER #0456", // descriptor as the alert shows it
  "amountMinor": 8423, // cents
  "hourLocal": 18, // 0-23, local time of purchase
  "issuerId": "venmo", // optional; P2P issuers make payments to people go to review
  "expectedCategoryId": "food.groceries", // must exist in packages/taxonomy
  "expectedNeedsReview": true, // optional; set where review is the expected behaviour
  "tags": ["multi_category"], // optional report slices
}
```

Labels are what a person would pick for that purchase, not what the categorizer currently
says, so the eval measures real accuracy and its gaps.

## Your own labeled set (never committed)

To measure accuracy on your real spending:

1. Create `evals/data/<anything>.real.json` with the same shape (`{ "version": 1, "items": [...] }`).
   The `*.real.json` pattern is in the root `.gitignore`, so the file stays on your machine.
2. Keep it minimal: descriptor, amount, hour and your category. No names, account numbers,
   balances or dates. For payments to people, replace the name with a placeholder.
3. Run `pnpm --filter @steadily/evals eval`. Real sets are picked up automatically; their
   confusion list shows item ids only, never descriptors.

Target: about 300 labeled transactions (BUILD_PLAN section 3), MVP bar 90% categorizer accuracy.
