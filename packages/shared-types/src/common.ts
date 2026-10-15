import { z } from 'zod';
import { isCategoryId, type CategoryId } from '@steadily/taxonomy';

export const Id = z.uuid();
export type Id = z.infer<typeof Id>;

/** ISO 8601 timestamp with offset, e.g. 2026-10-15T08:12:00.000Z */
export const Timestamp = z.iso.datetime({ offset: true });
export type Timestamp = z.infer<typeof Timestamp>;

/** ISO 4217 currency code. MVP is USD-only, but the type stays general. */
export const Currency = z.string().regex(/^[A-Z]{3}$/);
export type Currency = z.infer<typeof Currency>;

/** Money is always an integer number of minor units (cents). Never floats. */
export const AmountMinor = z.number().int().nonnegative();

export const CategoryIdSchema = z
  .string()
  .refine((value): value is CategoryId => isCategoryId(value), { message: 'Unknown category id' });

/** Exactly 4 digits. Full account/card numbers are never stored (D-011). */
export const AccountLast4 = z.string().regex(/^\d{4}$/);

export const Confidence = z.number().min(0).max(1);
