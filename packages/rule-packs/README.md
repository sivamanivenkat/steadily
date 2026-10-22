# @steadily/rule-packs

Per-issuer rules for turning US bank/card purchase alerts (push notifications and SMS) into
`ExtractedFields` (D-010, D-013). Rules are pure data: the TypeScript reference interpreter in
`src/parse.ts`, and later the Swift and Kotlin fast paths, read the same `packs/*.json` and must
produce identical results for every case in `fixtures/*.json`.

All packs are `verified: false`. No rule has been checked against a real alert on a device yet.
Most rules are written from general knowledge of how US issuers phrase alerts; where a public
source documents a format, the rule and its fixtures follow it (see [Evidence](#evidence)). A
pack is marked verified only after real (redacted) alerts were checked against it.

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

The fixture schema has no source field, so provenance is recorded by name: a case whose name
starts with `documented` is modeled on a public source listed in the
[fixture sources](#fixture-sources) table. Its text keeps the documented wording or layout, but
every value in it (merchant, amount, card ending, date) is invented.

## Evidence

Checked October 2026. Evidence levels:

- **none**: nothing public found; rules are educated guesses.
- **package-only**: the Android package (and maybe an SMS short code) is confirmed from official
  sources; alert wording is still a guess.
- **layout-documented**: a public source documents the wording or layout of a transaction alert
  in some channel (often the alert email, which users can share into the app as text). Push and
  SMS wording is still unconfirmed.
- **wording-documented**: a public source shows the push or SMS wording of purchase alerts.
  No pack reaches this level yet.

| Pack            | Evidence          | What is documented                                                                                                                                                 | Main gap                                                                                                                      |
| --------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| chase           | layout-documented | Legacy "A charge of ($USD) 25.40 at X has been authorized on ..." [W1]; alert email with Account (...NNNN) / Date / Merchant / Amount fields [W2]                  | Current push/SMS "You made a $X transaction with ..." wording is unconfirmed                                                  |
| capital_one     | package-only      | App, short code 227898 [S2]                                                                                                                                        | All wording                                                                                                                   |
| amex            | package-only      | App                                                                                                                                                                | All wording; no US SMS short code published (Canadian codes only)                                                             |
| citi            | layout-documented | Alert email "Account ending in NNNN ... A transaction of $X was made on your account ... Merchant ... Date" [W2]                                                   | Push/SMS wording; app pushes without the word "Citi" fall to `generic` (no issuerId)                                          |
| discover        | layout-documented | App, short code 347268 [S3]; alert email "Account ending in NNNN ... Merchant: X ... Amount: $X" [W2]                                                              | Push/SMS wording; 347268 is being replaced by per-alert-type codes not yet published                                          |
| bank_of_america | package-only      | App; security-check SMS "BofA Security: Did you use your debit card ending in NNNN at: X, $X, Declined, MM/DD? ... reply YES" [W3] (negative fixtures)             | All purchase wording; no official short code found                                                                            |
| wells_fargo     | layout-documented | App, alerts short code 93557 [S1]; alert email "Credit card ending NNNN ... $X ... Merchant detail X Date ..." [W2]                                                | Push/SMS wording                                                                                                              |
| us_bank         | layout-documented | App; alert email "Your U.S. Bank credit card has a new transaction ... was charged $X at X. ... ending in NNNN" [W2, last checked by its author in 2019]           | Push/SMS wording; no alert short code published (872265 is app-download only)                                                 |
| apple_card      | none              | No Android app and no SMS by design                                                                                                                                | Wallet notification wording                                                                                                   |
| venmo           | package-only      | App                                                                                                                                                                | All wording; 86753 is documented for verification texts only [S5], so it is not claimed                                       |
| cash_app        | package-only      | App                                                                                                                                                                | All wording; no official short code page found                                                                                |
| zelle           | package-only      | Bank apps that offer Zelle (Chase, BofA, Wells Fargo, U.S. Bank, Capital One, Citi [W4]). The standalone Zelle app (`com.zellepay.zelle`) is gone from Google Play | All wording varies by bank                                                                                                    |
| paypal          | package-only      | App                                                                                                                                                                | All wording; PayPal's help cites its security-text sender as "725-729" [S6] (commonly listed as 729725), so it is not claimed |
| generic         | n/a               | Fallback                                                                                                                                                           | Excludes fraud-check questions ("Did you use/attempt/make ...")                                                               |

### Android packages

Every id was confirmed on its Google Play listing (`https://play.google.com/store/apps/details?id=<id>`),
checking the listed developer, on 2026-10-22.

| Pack            | Package                                   | Play listing title             | Developer                   |
| --------------- | ----------------------------------------- | ------------------------------ | --------------------------- |
| chase           | `com.chase.sig.android`                   | Chase Mobile                   | JPMorgan Chase              |
| capital_one     | `com.konylabs.capitalone`                 | Capital One Mobile             | Capital One Services, LLC   |
| amex            | `com.americanexpress.android.acctsvcs.us` | Amex                           | American Express            |
| citi            | `com.citi.citimobile`                     | Citi Mobile®                   | Citibank N.A.               |
| discover        | `com.discoverfinancial.mobile`            | Discover Mobile                | Discover Financial Services |
| bank_of_america | `com.infonow.bofa`                        | Bank of America Mobile Banking | Bank of America             |
| wells_fargo     | `com.wf.wellsfargomobile`                 | Wells Fargo Mobile®            | Wells Fargo Mobile          |
| us_bank         | `com.usbank.mobilebanking`                | U.S. Bank Mobile Banking       | U.S. Bank Mobile            |
| venmo           | `com.venmo`                               | Venmo                          | PayPal Mobile               |
| cash_app        | `com.squareup.cash`                       | Cash App                       | Block, Inc.                 |
| paypal          | `com.paypal.android.p2pmobile`            | PayPal - Pay, Send, Save       | PayPal Mobile               |

### SMS short codes

A pack claims a short code (`sources.smsSenders`) only when the issuer's own site names it as a
sender of account alerts or of its general text channel. Codes that the issuer documents only for
one-time codes, fraud checks or app links are listed here but not claimed: claiming them would
not help parsing, since those texts must yield `null` anyway.

| Issuer                          | Code                                     | Use, per the source                                                  | Claimed | Source                                    |
| ------------------------------- | ---------------------------------------- | -------------------------------------------------------------------- | ------- | ----------------------------------------- |
| Wells Fargo                     | 93557 (WELLS)                            | Text alerts and enrollment                                           | yes     | [S1]                                      |
| Capital One                     | 227898                                   | Eno text channel; fraud texts come "from the same number every time" | yes     | [S2]                                      |
| Discover                        | 347268 (DISCOV)                          | Text alerts; being replaced by per-alert-type numbers                | yes     | [S3]                                      |
| Chase                           | 28107, 36640, 72166                      | Fraud and account security                                           | no      | [S4]                                      |
| Chase                           | 301528, 242733, 60969                    | One-time codes                                                       | no      | [S4]                                      |
| Chase                           | 74869; 35603, 64840, 23175, 24546, 55985 | Account updates; payment reminders                                   | no      | [S4] (no purchase-alert sender is listed) |
| Citi                            | 95686                                    | Fraud Early Warning                                                  | no      | [S7]                                      |
| Citi                            | 692484 (MYCITI)                          | App download link                                                    | no      | [S7]                                      |
| U.S. Bank                       | 872265                                   | App download link                                                    | no      | [S8]                                      |
| Venmo                           | 86753                                    | Verification texts                                                   | no      | [S5]                                      |
| PayPal                          | "725-729"                                | Security and verification texts                                      | no      | [S6]                                      |
| Amex, Bank of America, Cash App | none found                               | Only third-party lists or non-US pages                               | no      |                                           |

### Sources

- [S1] Wells Fargo alerts FAQ: https://www.wellsfargo.com/help/online-banking/alerts-faqs/
- [S2] Capital One credit card security features: https://www.capitalone.com/learn-grow/privacy-security/capital-one-credit-card-security-features/
- [S3] Discover text messaging alerts update: https://www.discover.com/text-migration
- [S4] Chase text messages: https://www.chase.com/digital/resources/privacy-security/security/self-service-text-messages
- [S5] Venmo phone and email verification: https://help.venmo.com/cs/articles/phone-and-email-verification-vhel283
- [S6] PayPal help HELP267: https://www.paypal.com/us/smarthelp/article/HELP267
- [S7] Citi Fraud Early Warning: https://www.cardbenefits.citi.com/Products/Fraud-Early-Warning
- [S8] U.S. Bank KB0069964: https://www.usbank.com/customer-service/knowledge-base/KB0069964.html
- [W1] Chase alert email parser in nathanmfast/ynab-assistant (`src/tools/chase-email-scraper.ts`):
  https://github.com/nathanmfast/ynab-assistant
- [W2] Per-bank alert email parsers in buzzlawless/live-import-for-ynab
  (`lambda_functions/parse*Email`; its README lists Chase, Citi, Discover and Wells Fargo as last
  verified Oct 2022, U.S. Bank Oct 2019): https://github.com/buzzlawless/live-import-for-ynab
- [W3] User-reported Bank of America security text (JustAnswer):
  https://www.justanswer.com/computer/hip1f-text-bank-america-someone-either.html
- [W4] Citi press release on Zelle in Citi Mobile (2017):
  https://www.citigroup.com/global/news/press-release/2017/citi-enables-p2p-payments-with-zelle-network

[W1] to [W3] are third-party sources describing real alerts. They establish a format, not the
current wording, so packs that rely on them stay `verified: false`.

### Fixture sources

| Fixture file         | Fixture name                                                           | Source                |
| -------------------- | ---------------------------------------------------------------------- | --------------------- |
| chase.json           | documented legacy wording: charge has been authorized (sms)            | [W1]                  |
| chase.json           | documented legacy wording: charge has been authorized (push, no brand) | [W1]                  |
| chase.json           | documented layout: shared alert email with field table                 | [W2]                  |
| citi.json            | documented layout: shared alert email with merchant and date fields    | [W2]                  |
| citi.json            | documented layout: transaction sentence without merchant               | [W2]                  |
| discover.json        | documented layout: shared alert email with labeled fields              | [W2]                  |
| wells_fargo.json     | documented layout: shared alert email with merchant detail             | [W2]                  |
| us_bank.json         | documented wording: card was charged at merchant                       | [W2] (email sentence) |
| us_bank.json         | documented layout: shared new transaction email                        | [W2]                  |
| bank_of_america.json | negative: documented security check for a declined card use            | [W3]                  |

The cases named `sms from published short code ...` exercise the claimed codes from the short
code table. All other fixtures are synthetic guesses.

## Sources TODO

- Capture real (redacted) push and SMS alerts for every issuer and compare them with the packs;
  only then set `verified: true`.
- Citi and Discover have no `push` rules. App notifications without the brand name in the text
  are parsed by `generic` and carry no `issuerId`.
- Discover's new per-alert-type short codes, and US alert short codes for Amex, Bank of America,
  Chase purchase alerts, Cash App and U.S. Bank, are not officially published.

## Issuer notes

- **Apple Card** has no SMS alerts and no Android app. Its alerts are iOS Wallet push
  notifications, which other apps cannot read, so they reach Steadily only as shared text or
  screenshot OCR (or as structured fields from the Apple Pay Shortcuts automation, which needs
  no parsing). The pack therefore has no sources and only `any` rules anchored on the words
  "Apple Card". Daily Cash and payment notices are excluded.
- **Zelle** has no alerts of its own any more: transfers are announced by the bank app or bank
  SMS ("You sent $50.00 to Sam Example with Zelle"). The `zelle` pack lists the bank apps that
  offer Zelle in `sources.androidPackages`, so it is tried right after the bank's own pack when
  one of those apps posts the alert. Every Zelle rule still requires the word "Zelle" (or a
  "Zelle:" prefix) in the text, so ordinary bank alerts never match it. The `wells_fargo` and
  `us_bank` packs exclude "Zelle" so those alerts fall through to the `zelle` pack. Like Venmo
  and Cash App, Zelle and PayPal are P2P issuers: money received is a transfer, and payments to
  people always go to review.
- **PayPal** alerts cover both payments to people and checkout at merchants ("You paid $9.99
  USD to Spotify"); the categorizer tells them apart with the merchant dictionary. Requests and
  transfers to the bank are excluded.
