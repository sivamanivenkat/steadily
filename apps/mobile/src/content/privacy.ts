/**
 * Privacy copy (D-011) in one place: the per-transaction "What we kept" lists, and the cloud AI
 * disclosure shown in Settings and on the Privacy screen.
 *
 * "What we kept" is built from the stored columns of the transaction only. "What we didn't keep"
 * is derived from the capture source alone: it describes what that kind of capture contains and
 * is thrown away, never anything read from the original alert, which is not stored.
 */
import type { CaptureSource, CategorySource, TransactionKind } from '@steadily/shared-types';

import { categoryMeta } from '@/components/CategoryTile';
import { isP2PIssuer, issuerName } from '@/data/issuers';
import type { Transaction } from '@/data/types';
import { dateTimeLabel } from '@/lib/dates';
import { formatMoney } from '@/lib/money';

/** Settings and Privacy screen: what cloud AI sends when the user turned it on. */
export const CLOUD_SENT_SUMMARY =
  'When on, Steadily sends the text of your question plus totals only: no individual transactions, no notes, no names of people you paid. Local business names are grouped as “Other merchants”. For an unclear charge, the merchant name and amount are sent. All of it goes through Steadily’s server to a cloud AI model.';

/** What cloud AI never receives, on or off. */
export const CLOUD_NEVER_SENT =
  'Never sent: alert text, screenshots, card numbers, account details or your name.';

export const SOURCE_LABEL: Record<CaptureSource, string> = {
  android_notification: 'Bank notification',
  ios_sms_shortcut: 'Text message alert',
  ios_apple_pay_shortcut: 'Apple Pay',
  share_text: 'Shared text',
  share_image: 'Shared screenshot',
  share_pdf: 'Shared PDF',
  csv_import: 'CSV import',
  manual: 'Added by you',
};

/** Who picked the category. */
export const CATEGORY_SOURCE_LABEL: Record<CategorySource, string> = {
  user: 'You',
  user_rule: 'Your rule for this merchant',
  dictionary: 'Known-merchant list on this phone',
  classifier: 'Best guess on this phone',
  on_device_llm: 'Best guess on this phone',
  cloud_llm: 'Cloud AI (you opted in)',
  none: 'Not chosen yet',
};

export const KIND_LABEL: Record<TransactionKind, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Not an expense',
  refund: 'Refund',
};

export type KeptField = { label: string; value: string };

/**
 * The stored fields of a transaction a person would recognise, and nothing else. Bookkeeping
 * columns (id, save times, the category guess's confidence, review status, a link to a duplicate)
 * are summed up in `KEPT_BOOKKEEPING` instead of listed.
 */
export function keptFields(tx: Transaction): KeptField[] {
  return [
    { label: 'Amount', value: `${formatMoney(tx.amountMinor)} ${tx.currency}` },
    { label: 'Merchant', value: tx.merchantName ?? 'Not captured' },
    { label: 'Merchant as written', value: tx.merchantRaw ?? 'Not captured' },
    { label: 'Date and time', value: dateTimeLabel(new Date(tx.occurredAt)) },
    { label: 'Card', value: tx.accountLast4 ? `Ending ${tx.accountLast4}` : 'Not captured' },
    { label: 'Bank or app', value: issuerName(tx.issuerId) ?? 'Not captured' },
    { label: 'Captured from', value: SOURCE_LABEL[tx.source] },
    { label: 'Type', value: KIND_LABEL[tx.kind] },
    { label: 'Category', value: categoryMeta(tx.categoryId).name },
    { label: 'Category chosen by', value: CATEGORY_SOURCE_LABEL[tx.categorySource] },
    { label: 'Reference number', value: tx.txnRef ?? 'None' },
    { label: 'Note', value: tx.note ?? 'None' },
  ];
}

export const KEPT_BOOKKEEPING =
  'Plus bookkeeping only Steadily uses: an id, when it was saved, how sure the category guess was and whether it needs review.';

/** One line on how the original was handled, per source. */
export function keptIntro(source: CaptureSource): string {
  switch (source) {
    case 'android_notification':
      return 'Only these fields are stored, encrypted on this phone. The notification was read here and its text was never saved.';
    case 'ios_sms_shortcut':
    case 'ios_apple_pay_shortcut':
      return 'Only these fields are stored, encrypted on this phone. What your Shortcut passed in was read here and deleted once these fields were taken out.';
    case 'share_text':
    case 'share_image':
    case 'share_pdf':
      return 'Only these fields are stored, encrypted on this phone. What you shared was read here and deleted once these fields were taken out.';
    case 'csv_import':
      return 'Only these fields are stored, encrypted on this phone. The file was read here and not copied into Steadily.';
    case 'manual':
      return 'Only what you typed is stored, encrypted on this phone.';
  }
}

const CARD_NUMBERS = 'Full card or account numbers (only the last 4 digits)';
const BALANCES = 'Balances and available credit';
const CODES = 'One-time codes and security messages';

function names(tx: Pick<Transaction, 'issuerId'>): string {
  return isP2PIssuer(tx.issuerId)
    ? 'Other names in it (the person you paid is kept as the merchant)'
    : 'Names in it, including yours';
}

/**
 * What this kind of capture contains that Steadily dropped. Empty for transactions the user typed
 * in: there was nothing else.
 */
export function notKeptFields(tx: Pick<Transaction, 'source' | 'issuerId'>): string[] {
  switch (tx.source) {
    case 'android_notification':
      return [
        'The full notification text',
        BALANCES,
        CARD_NUMBERS,
        names(tx),
        CODES,
        'Your other notifications: apps not on Steadily’s list are never read',
      ];
    case 'ios_sms_shortcut':
      return [
        'The full text message',
        'The sender’s number or short code',
        BALANCES,
        CARD_NUMBERS,
        names(tx),
        CODES,
        'Your other messages: only what your Shortcut passes in is read',
      ];
    case 'ios_apple_pay_shortcut':
      return [
        'The full text your Shortcut passed in',
        'The card’s name in Wallet',
        CARD_NUMBERS,
        'Your other Wallet activity',
      ];
    case 'share_text':
      return [
        'The full text you shared',
        'Which app you shared it from',
        BALANCES,
        CARD_NUMBERS,
        names(tx),
      ];
    case 'share_image':
      return [
        'The screenshot itself',
        'All other text read from it',
        'Anything else on the screen, like your balance',
        CARD_NUMBERS,
      ];
    case 'share_pdf':
      return ['The PDF file', 'All other text in it', BALANCES, CARD_NUMBERS, names(tx)];
    case 'csv_import':
      return [
        'The original file',
        'Columns Steadily didn’t use, such as running balance',
        CARD_NUMBERS,
      ];
    case 'manual':
      return [];
  }
}
