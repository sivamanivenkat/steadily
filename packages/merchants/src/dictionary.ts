import { z } from 'zod';
import { isCategoryId, type CategoryId } from '@steadily/taxonomy';
import data from '../data/merchants.json';

const MerchantKey = z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/);

export const MerchantEntry = z.object({
  key: MerchantKey,
  name: z.string().min(1).max(100),
  categoryId: z
    .string()
    .refine((v): v is CategoryId => isCategoryId(v), { message: 'Unknown category id' }),
  /** Sells across categories (e.g. groceries and electronics); the default is a weak guess. */
  multiCategory: z.boolean().optional(),
  /** Other keys normalized descriptors produce for this merchant, e.g. "wholefds_mkt". */
  aliases: z.array(MerchantKey).optional(),
});
export type MerchantEntry = z.infer<typeof MerchantEntry>;

export const MerchantDictionary = z.object({
  version: z.number().int().positive(),
  merchants: z.array(MerchantEntry),
});
export type MerchantDictionary = z.infer<typeof MerchantDictionary>;

export const DICTIONARY: MerchantDictionary = MerchantDictionary.parse(data);

const byKey = new Map<string, MerchantEntry>();
for (const entry of DICTIONARY.merchants) {
  for (const k of [entry.key, ...(entry.aliases ?? [])]) {
    if (byKey.has(k)) throw new Error(`Duplicate merchant key or alias: ${k}`);
    byKey.set(k, entry);
  }
}

/** Finds a known merchant by its key or one of its aliases. */
export function lookupMerchant(key: string): MerchantEntry | undefined {
  return byKey.get(key);
}
