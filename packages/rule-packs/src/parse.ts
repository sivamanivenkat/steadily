import { ExtractedFields } from '@steadily/shared-types';
import { AlertInput, GENERIC_ISSUER_ID, type Direction, type RulePack } from './schema';

type Channel = 'push' | 'sms';

/** Step 1 of the shared algorithm: every whitespace run becomes one ASCII space, then trim. */
export function normalizeAlertText(text: string): string {
  return text.replace(/[\s   ]+/g, ' ').trim();
}

/** "$1,234.56" | "1,234.56" | "USD 12.30" | "$5" -> integer cents, or null if malformed. */
export function parseAmountToMinor(raw: string): number | null {
  const cleaned = raw.replace(/USD/gi, '').replace(/[$,\s]/g, '');
  const m = /^([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  const dollars = Number(m[1]);
  const cents = Number((m[2] ?? '').padEnd(2, '0'));
  const minor = dollars * 100 + cents;
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Trim, collapse whitespace, drop trailing punctuation. */
export function cleanMerchant(raw: string): string | undefined {
  const s = raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.,;:!]+$/, '')
    .slice(0, 200)
    .trim();
  return s.length > 0 ? s : undefined;
}

const CREDIT_WORDS = ['refund', 'credit', 'deposit', 'received', 'return', 'paid you', 'sent you'];
const DEBIT_WORDS = ['purchase', 'debit', 'charge', 'withdrawal', 'spent', 'paid', 'sent'];

/** Maps a captured `direction` group to debit/credit; credit words win. */
export function directionFromText(captured: string, fallback: Direction): Direction {
  const t = captured.toLowerCase();
  if (CREDIT_WORDS.some((w) => t.includes(w))) return 'credit';
  if (DEBIT_WORDS.some((w) => t.includes(w))) return 'debit';
  return fallback;
}

function inputChannel(input: AlertInput): Channel | null {
  if (input.androidPackage || input.source === 'android_notification') return 'push';
  if (input.smsSender || input.source === 'ios_sms_shortcut') return 'sms';
  return null;
}

function claims(pack: RulePack, input: AlertInput): boolean {
  if (input.androidPackage && pack.sources.androidPackages.includes(input.androidPackage)) {
    return true;
  }
  const sender = input.smsSender?.trim().toLowerCase();
  return !!sender && pack.sources.smsSenders.some((s) => s.toLowerCase() === sender);
}

const regexCache = new Map<string, RegExp>();
function compile(pattern: string): RegExp {
  let re = regexCache.get(pattern);
  if (!re) {
    re = new RegExp(pattern, 'i');
    regexCache.set(pattern, re);
  }
  return re;
}

/**
 * Reference interpreter for rule packs. Swift and Kotlin implement the same algorithm
 * (README "Interpreter algorithm") and must agree on every fixture.
 */
export function parseAlert(
  rawInput: AlertInput,
  packs: readonly RulePack[],
): ExtractedFields | null {
  const input = AlertInput.parse(rawInput);
  const text = normalizeAlertText(input.text);
  if (!text) return null;

  const channel = inputChannel(input);
  const specific = packs.filter((p) => p.issuerId !== GENERIC_ISSUER_ID);
  const generic = packs.filter((p) => p.issuerId === GENERIC_ISSUER_ID);
  const claimed = specific.filter((p) => claims(p, input));
  const bySource = claimed.length > 0;
  const ordered = [...(bySource ? claimed : specific), ...generic];

  for (const pack of ordered) {
    if (pack.exclude?.some((p) => compile(p).test(text))) continue;
    for (const rule of pack.rules) {
      if (rule.channel !== 'any' && rule.channel !== channel) continue;
      // Push rules are brand-agnostic, so they only run for the app that posted the alert.
      if (rule.channel === 'push' && !bySource) continue;

      const groups = compile(rule.pattern).exec(text)?.groups;
      if (!groups?.amount) continue;
      const amountMinor = parseAmountToMinor(groups.amount);
      if (amountMinor === null) continue;

      const merchantRaw = groups.merchant ? cleanMerchant(groups.merchant) : undefined;
      const last4 = groups.last4 && /^[0-9]{4}$/.test(groups.last4) ? groups.last4 : undefined;
      const txnRef = groups.txnRef?.trim().slice(0, 100) || undefined;
      const candidate = {
        amountMinor,
        currency: 'USD',
        direction: groups.direction
          ? directionFromText(groups.direction, rule.direction)
          : rule.direction,
        occurredAt: input.receivedAt,
        ...(merchantRaw ? { merchantRaw } : {}),
        ...(last4 ? { accountLast4: last4 } : {}),
        ...(txnRef ? { txnRef } : {}),
        ...(pack.issuerId !== GENERIC_ISSUER_ID ? { issuerId: pack.issuerId } : {}),
      };
      const result = ExtractedFields.safeParse(candidate);
      if (result.success) return result.data;
    }
  }
  return null;
}
