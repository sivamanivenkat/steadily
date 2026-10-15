import { lookupMerchant } from './dictionary';

export interface NormalizedMerchant {
  /** Display name, e.g. "Blue Bottle Coffee". */
  name: string;
  /** Lowercase stable key for user rules and the dictionary, e.g. "blue_bottle_coffee". */
  key: string;
}

/** "Trader Joe's" -> "trader_joes", "AT&T" -> "att", "7-Eleven" -> "7_eleven". */
export function toMerchantKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’.&+]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Whole-descriptor rewrites for big aggregators, applied first. */
const CANONICAL: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(?:AMAZON PRIME|PRIME VIDEO)(?:[\s*].*)?$/, 'AMAZON PRIME'],
  [
    /^(?:AMZN MKTP(?: US)?|AMZN\.COM|AMZN DIGITAL|AMZN|AMAZON MKTPL(?:ACE)?|AMAZON MARKETPLACE|AMAZON\.COM|AMAZON RETA)(?:[\s*/].*)?$/,
    'AMAZON',
  ],
  [/^UBER\s*\*?\s*EATS\b.*$/, 'UBER EATS'],
  [/^UBER(?:\s*\*\s*|\s+)(?:TRIP|PENDING|RIDES?)\b.*$/, 'UBER'],
  [/^LYFT\s*\*.*$/, 'LYFT'],
  [/^APPLE\.COM\/BILL.*$/, 'APPLE.COM/BILL'],
];

/** Payment processor / aggregator prefixes: "SQ *", "TST* ", "PAYPAL *", ... */
const PROCESSOR_PREFIX = /^(?:SQ|TST|PAYPAL|PP|SP|DD|DOORDASH|GOOGLE)\s*\*\s*/;

const US_STATES = new Set(
  (
    'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH ' +
    'NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'
  ).split(' '),
);
/** State codes that are also common words in merchant names ("PIZZA CO", "IN", "OR"). */
const AMBIGUOUS_STATES = new Set([
  'CO',
  'IN',
  'OR',
  'ME',
  'OK',
  'HI',
  'DE',
  'LA',
  'MA',
  'AL',
  'PA',
  'ID',
  'OH',
]);
const MULTI_WORD_CITIES = [
  'SAN FRANCISCO',
  'SOUTH SAN FRANCISCO',
  'NEW YORK',
  'LOS ANGELES',
  'SAN DIEGO',
  'SAN JOSE',
  'SAN ANTONIO',
  'LAS VEGAS',
  'SALT LAKE CITY',
  'ST LOUIS',
  'SAINT LOUIS',
  'KANSAS CITY',
  'NEW ORLEANS',
  'FORT WORTH',
  'EL PASO',
  'OKLAHOMA CITY',
  'LONG BEACH',
  'VIRGINIA BEACH',
  'COLORADO SPRINGS',
  'BATON ROUGE',
  'SANTA MONICA',
  'SANTA CLARA',
  'PALO ALTO',
  'MOUNTAIN VIEW',
  'JERSEY CITY',
  'WASHINGTON DC',
].map((c) => c.split(' '));

const CORPORATE_SUFFIX = new Set(['INC', 'LLC', 'CORP', 'LTD', 'CO.', 'INC.', 'L.L.C.']);
const SMALL_WORDS = new Set(['and', 'of', 'the', 'in', 'at', 'for', 'on', 'a']);
const VOWELS = /[AEIOUY]/;

function isStoreNumber(token: string, next: string | undefined): boolean {
  if (/^#/.test(token)) return true;
  if (/^[0-9]{3,}$/.test(token)) return true;
  if (/^[A-Z]-?[0-9]{3,}$/.test(token)) return true; // "T-1234"
  return /^(?:STORE|STR|STO|NO|UNIT)$/.test(token) && !!next && /^#?[0-9]+$/.test(next);
}

function endsWith(tokens: string[], tail: string[]): boolean {
  if (tail.length > tokens.length) return false;
  return tail.every((t, i) => tokens[tokens.length - tail.length + i] === t);
}

/** Drops a trailing "CITY ST" when it looks like a location suffix. */
function stripCityState(tokens: string[]): string[] {
  const last = tokens[tokens.length - 1];
  if (!last || !US_STATES.has(last)) return tokens;
  const body = tokens.slice(0, -1);
  for (const city of MULTI_WORD_CITIES) {
    if (body.length > city.length && endsWith(body, city)) return body.slice(0, -city.length);
  }
  const minTokens = AMBIGUOUS_STATES.has(last) ? 4 : 3;
  return tokens.length >= minTokens ? body.slice(0, -1) : tokens;
}

/** Longest token prefix that is a known merchant. */
function dictionaryPrefix(tokens: string[]) {
  for (let n = tokens.length; n >= 1; n--) {
    const entry = lookupMerchant(toMerchantKey(tokens.slice(0, n).join(' ')));
    if (entry) return entry;
  }
  return undefined;
}

function titleCaseWord(word: string, index: number): string {
  const lower = word.toLowerCase();
  if (index > 0 && SMALL_WORDS.has(lower)) return lower;
  if (word.includes('&') && word.length <= 5) return word; // AT&T, H&M
  const letters = word.replace(/[^A-Z]/g, '');
  if (letters.length >= 2 && letters.length <= 4 && !VOWELS.test(letters)) return word; // CVS, KFC
  return lower.replace(
    /(^|[\s\-/.&(])([a-z])/g,
    (_, sep: string, c: string) => sep + c.toUpperCase(),
  );
}

function titleCase(tokens: string[]): string {
  const merged: string[] = [];
  for (const t of tokens) {
    // Processors often drop apostrophes: "JOE S" -> "Joe's".
    if (t === 'S' && merged.length > 0) merged[merged.length - 1] += "'S";
    else merged.push(t);
  }
  return merged.map(titleCaseWord).join(' ');
}

/**
 * Turns a raw card descriptor ("SQ *BLUE BOTTLE COFFEE", "AMZN Mktp US*2K4AB1C23",
 * "STARBUCKS STORE 12345 SEATTLE WA") into a display name and a stable key.
 * Known merchants resolve to their dictionary name and key.
 */
export function normalizeMerchant(raw: string): NormalizedMerchant {
  let s = raw.normalize('NFKC').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!s) return { name: '', key: '' };

  for (const [re, replacement] of CANONICAL) {
    if (re.test(s)) {
      s = replacement;
      break;
    }
  }

  for (let i = 0; i < 3; i++) {
    const m = PROCESSOR_PREFIX.exec(s);
    if (!m || m[0].length >= s.length) break;
    s = s.slice(m[0].length);
  }

  s = s
    .replace(/\*\s*[A-Z0-9]*[0-9][A-Z0-9]*\b/g, ' ') // "*2K4AB1C23" reference codes
    .replace(/\*/g, ' ')
    .replace(/\b1?-?[0-9]{3}[-. ][0-9]{3}[-. ][0-9]{4}\b/g, ' ') // phone numbers
    .replace(/^WWW\./, '')
    .replace(/\.(?:COM|NET|ORG)(?:\/\S*)?\b/g, '')
    .replace(/#/g, ' #')
    .replace(/[,;:"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let tokens = s.split(' ').filter(Boolean);
  const cut = tokens.findIndex((t, i) => i > 0 && isStoreNumber(t, tokens[i + 1]));
  if (cut > 0) tokens = tokens.slice(0, cut);
  while (tokens.length > 1 && CORPORATE_SUFFIX.has(tokens[tokens.length - 1] ?? '')) tokens.pop();

  const known = dictionaryPrefix(tokens);
  if (known) return { name: known.name, key: known.key };

  tokens = stripCityState(tokens);
  tokens = tokens.map((t) => t.replace(/^[-.]+|[-.]+$/g, '')).filter(Boolean);
  if (tokens.length === 0) {
    tokens = raw.toUpperCase().replace(/\s+/g, ' ').trim().split(' ');
  }

  const name = titleCase(tokens);
  return { name, key: toMerchantKey(name) };
}
