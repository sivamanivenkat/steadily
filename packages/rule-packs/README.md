# @steadily/rule-packs

Per-issuer rules for turning US bank/card purchase alerts (push notifications and SMS) into
`ExtractedFields` (D-010, D-013). Rules are pure data: the TypeScript reference interpreter in
`src/parse.ts`, and later the Swift and Kotlin fast paths, read the same `packs/*.json` and must
produce identical results for every case in `fixtures/*.json`.

All packs are `verified: false`. They are synthetic, written from general knowledge of how US
issuers phrase alerts, and must be checked against real (redacted) alerts before a pack is
marked verified.

## Pack format

```jsonc
{
  "issuerId": "chase", // [a-z0-9_]; "generic" is the brand-agnostic fallback
  "displayName": "Chase",
  "version": 1, // integer, bump on every change (packs can be updated over the air)
  "verified": false,
  "sources": {
    "androidPackages": ["com.chase.sig.android"], // apps whose notifications this pack claims
    "smsSenders": [], // SMS short codes / sender ids this pack claims
  },
  "exclude": ["declined"], // optional: if any matches, this pack yields nothing
  "rules": [
    {
      "id": "chase_txn", // unique across all packs
      "channel": "any", // "push" | "sms" | "any"
      "pattern": "...", // portable regex, see below
      "direction": "debit", // default; a `direction` group may override it
    },
  ],
}
```

The zod schema is `RulePack` in `src/schema.ts`.

## Interpreter algorithm

Every implementation must follow these steps exactly.

1. **Normalize text.** Replace every run of whitespace (including newlines, tabs, U+00A0,
   U+2007, U+202F) with one ASCII space, then trim. Empty text returns `null`.
2. **Channel.** `push` if `androidPackage` is set or `source == "android_notification"`;
   otherwise `sms` if `smsSender` is set or `source == "ios_sms_shortcut"`; otherwise unknown.
3. **Pick packs.** A pack _claims_ the alert if `androidPackage` is in `sources.androidPackages`
   or `smsSender` equals (case-insensitively, trimmed) one of `sources.smsSenders`. If any pack
   claims it, try the claiming packs in bundle order, then `generic`. Otherwise try every
   non-generic pack in bundle order, then `generic`.
4. **Exclusions.** Skip a pack if any of its `exclude` patterns matches the normalized text.
5. **Rules, in file order.** A rule is eligible if `channel` is `any` or equals the input channel.
   Rules with `channel: "push"` are brand-agnostic, so they run only when the pack claimed the
   alert by source. Find the first (leftmost) match of the pattern anywhere in the text,
   case-insensitively. The first eligible rule that matches and produces a valid result wins.
6. **Fields.**
   - `amount` (required): remove `USD`, `$`, `,` and spaces; must then be `digits[.d|.dd]`.
     Convert to integer cents without floating point (`"12.3"` -> 1230, `"5"` -> 500). Malformed
     amounts make the rule not match.
   - `merchant`: collapse whitespace, trim, drop trailing `. , ; : !` and spaces, cap at 200
     chars. Empty means no `merchantRaw`.
   - `last4`: used only if exactly 4 ASCII digits.
   - `direction`: lowercase the capture. If it contains any credit word it is `credit`; else if
     it contains any debit word it is `debit`; else the rule's `direction`. Credit words:
     "refund", "credit", "deposit", "received", "return", "paid you", "sent you". Debit words:
     "purchase", "debit", "charge", "withdrawal", "spent", "paid", "sent".
   - `txnRef`: trimmed, capped at 100 chars.
   - `date`: captured for future use; v1 ignores it.
   - `currency` is always `USD`; `occurredAt` is the input `receivedAt`.
   - `issuerId` is the pack's id, omitted for the `generic` pack.
7. The result must validate against `ExtractedFields`; if not, continue with the next rule.

## Portable regex subset

Patterns must behave the same in JavaScript (`RegExp`, flag `i`), Swift (`NSRegularExpression`,
`.caseInsensitive`) and Kotlin/Java (`java.util.regex.Pattern`, `CASE_INSENSITIVE`). Allowed:

- Literals, `.`, `^`, `$`, alternation `|`, groups `( )`, non-capturing `(?: )`.
- Named groups `(?<name>...)` using only: `amount` (required), `merchant`, `last4`, `direction`,
  `date`, `txnRef`. Each name at most once per pattern (no duplicate names across alternatives).
- Character classes with explicit ASCII ranges, e.g. `[0-9]`, `[A-Za-z]`, `[^:$]`.
- Quantifiers `* + ? {n} {n,} {n,m}` and their lazy forms `*? +? ??`.
- Escapes for literal punctuation (`\. \$ \( \) \* \/ \-`) and `\s`.

Not allowed (checked by `checkPortablePattern` in the tests): lookbehind `(?<=` `(?<!`, inline
flags `(?i)`, atomic groups `(?>`, possessive quantifiers, backreferences `\1` `\k<name>`,
`\d \w \b` and their negations (Unicode semantics differ: use `[0-9]`, `[A-Za-z]`), `\p{..}`,
POSIX classes, class intersection `&&`, and any JS-only flag (`g y s u v d`). Matching is
always case-insensitive and never multi-line; text is a single line after step 1, so `.` never
needs to cross a newline. Lookahead `(?=` `(?!` is portable but avoid it unless needed.

## Fixtures

`fixtures/<issuerId>.json` is an array of
`{ name, input: { text, receivedAt, source?, androidPackage?, smsSender? }, expected }`, where
`expected` is an `ExtractedFields` object or `null` (OTP codes, promos, balances, declines,
requests and transfers must yield `null`). Every fixture is synthetic: placeholder names such as
"Sam Example", card endings like 1234/4821, never full account numbers.

## Sources TODO

Android package names are filled in only where well known; all must be confirmed on a device.

- TODO: Citi and Discover Android package names (left empty rather than guessed).
- TODO: SMS sender short codes for every issuer (left empty rather than guessed). Until they are
  filled in, SMS alerts are matched by the brand name in the text (`any` rules).
- TODO: Wells Fargo, US Bank and Zelle packs.
