import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { isBuiltInCategoryId, type BuiltInCategoryId } from '@steadily/taxonomy';

export const EVALS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = join(EVALS_ROOT, 'data');
export const SYNTHETIC_DATASET = join(DATA_DIR, 'categorize.synthetic.json');

/** One labeled spending transaction. Synthetic or fully redacted only. */
export const LabeledTransaction = z.object({
  id: z.string().min(1),
  /** Descriptor as the alert shows it, e.g. "SQ *BLUE BOTTLE COFFEE". */
  merchantRaw: z.string().min(1).max(200),
  amountMinor: z.number().int().positive(),
  /** Local hour of the purchase, 0-23. */
  hourLocal: z.number().int().min(0).max(23),
  /** Rule-pack issuer, e.g. "venmo" for a P2P payment. */
  issuerId: z.string().min(1).max(50).optional(),
  expectedCategoryId: z
    .string()
    .refine((v): v is BuiltInCategoryId => isBuiltInCategoryId(v), 'unknown category id'),
  /** Set where review is part of the expected behaviour (P2P, multi-category...). */
  expectedNeedsReview: z.boolean().optional(),
  /** Slices for the report, e.g. "p2p", "multi_category", "local_business". */
  tags: z.array(z.string().min(1)).optional(),
});
export type LabeledTransaction = z.infer<typeof LabeledTransaction>;

export const LabeledDataset = z.object({
  version: z.number().int().positive(),
  items: z.array(LabeledTransaction).min(1),
});
export type LabeledDataset = z.infer<typeof LabeledDataset>;

export function loadDataset(path: string): LabeledDataset {
  const data = LabeledDataset.parse(JSON.parse(readFileSync(path, 'utf8')));
  const ids = data.items.map((i) => i.id);
  if (new Set(ids).size !== ids.length) throw new Error(`duplicate item ids in ${path}`);
  return data;
}
