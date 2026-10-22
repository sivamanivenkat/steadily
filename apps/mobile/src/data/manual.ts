import { FALLBACK_CATEGORY_ID } from '@steadily/taxonomy';

import type { ManualTransactionInput } from './types';

/** Largest amount the Add screen accepts: $9,999,999.99. */
export const MAX_MANUAL_AMOUNT_MINOR = 999_999_999;
export const MAX_MERCHANT_LENGTH = 200;
export const MAX_NOTE_LENGTH = 500;

/**
 * Checks and tidies a manual entry: positive whole cents, a merchant name, a valid date. Income
 * is not spending, so it always files under the fallback category. Throws on bad input (the
 * message never echoes the values).
 */
export function cleanManualInput(input: ManualTransactionInput): ManualTransactionInput {
  const { amountMinor, kind } = input;
  if (!Number.isInteger(amountMinor) || amountMinor <= 0 || amountMinor > MAX_MANUAL_AMOUNT_MINOR) {
    throw new Error('Amount must be a positive number of cents');
  }
  const merchant = input.merchant.trim().replace(/\s+/g, ' ').slice(0, MAX_MERCHANT_LENGTH);
  if (merchant === '') throw new Error('Merchant is required');
  const at = Date.parse(input.occurredAt);
  if (Number.isNaN(at)) throw new Error('Invalid date');
  const note = input.note?.trim().slice(0, MAX_NOTE_LENGTH) ?? '';
  return {
    amountMinor,
    merchant,
    categoryId: kind === 'income' ? FALLBACK_CATEGORY_ID : input.categoryId,
    occurredAt: new Date(at).toISOString(),
    kind,
    note: note === '' ? null : note,
  };
}
