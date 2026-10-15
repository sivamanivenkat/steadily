import { z } from 'zod';
import {
  AccountLast4,
  AmountMinor,
  CategoryIdSchema,
  Confidence,
  Currency,
  Id,
  Timestamp,
} from './common';

/** Where a transaction came from. */
export const CaptureSource = z.enum([
  'android_notification',
  'ios_sms_shortcut',
  'ios_apple_pay_shortcut',
  'share_text',
  'share_image',
  'share_pdf',
  'csv_import',
  'manual',
]);
export type CaptureSource = z.infer<typeof CaptureSource>;

/** Income and transfers are not spending; refunds offset spending. */
export const TransactionKind = z.enum(['expense', 'income', 'transfer', 'refund']);
export type TransactionKind = z.infer<typeof TransactionKind>;

/** Which step of the categorizer produced the category (D-010). */
export const CategorySource = z.enum([
  'user',
  'user_rule',
  'dictionary',
  'classifier',
  'on_device_llm',
  'cloud_llm',
  'none',
]);
export type CategorySource = z.infer<typeof CategorySource>;

export const TransactionStatus = z.enum(['confirmed', 'needs_review']);
export type TransactionStatus = z.infer<typeof TransactionStatus>;

/**
 * Fields a parser can extract from an alert, share or import.
 * Raw alert text is never part of this: it lives only in the short-lived inbox.
 */
export const ExtractedFields = z.object({
  amountMinor: AmountMinor,
  currency: Currency,
  direction: z.enum(['debit', 'credit']),
  merchantRaw: z.string().min(1).max(200).optional(),
  occurredAt: Timestamp,
  accountLast4: AccountLast4.optional(),
  /** Issuer transaction / reference id, used for dedup. */
  txnRef: z.string().max(100).optional(),
  /** Rule-pack issuer id, e.g. "chase", "venmo". */
  issuerId: z.string().max(50).optional(),
});
export type ExtractedFields = z.infer<typeof ExtractedFields>;

/** A stored transaction. Sync-ready: uuid id, updatedAt, deletedAt tombstone. */
export const Transaction = z.object({
  id: Id,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  deletedAt: Timestamp.nullable(),
  occurredAt: Timestamp,
  amountMinor: AmountMinor,
  currency: Currency,
  kind: TransactionKind,
  merchantRaw: z.string().max(200).nullable(),
  merchantName: z.string().max(200).nullable(),
  categoryId: CategoryIdSchema,
  categoryConfidence: Confidence,
  categorySource: CategorySource,
  status: TransactionStatus,
  source: CaptureSource,
  accountLast4: AccountLast4.nullable(),
  issuerId: z.string().max(50).nullable(),
  txnRef: z.string().max(100).nullable(),
  note: z.string().max(500).nullable(),
  /** Refund -> original, or duplicate -> kept transaction. */
  linkedTransactionId: Id.nullable(),
});
export type Transaction = z.infer<typeof Transaction>;
