import { z } from 'zod';

export const Settings = z.object({
  /** Opt-in cloud AI (Claude via edge function). Off by default (D-011). */
  cloudAiOptIn: z.boolean(),
  /** D-012: notify only when unsure, or for every transaction. */
  notifyMode: z.enum(['unsure_only', 'every_transaction', 'off']),
  dailySummary: z.boolean(),
  /** Local time "HH:MM"; null disables quiet hours. */
  quietHours: z
    .object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) })
    .nullable(),
  /** Keep shared screenshots as encrypted receipts (opt-in). */
  keepReceiptImages: z.boolean(),
  theme: z.enum(['system', 'light', 'dark']),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = {
  cloudAiOptIn: false,
  notifyMode: 'unsure_only',
  dailySummary: true,
  quietHours: { start: '22:00', end: '07:00' },
  keepReceiptImages: false,
  theme: 'system',
};

/** Confidence at or above which a category is saved without review (D-010). */
export const AUTO_SAVE_CONFIDENCE = 0.85;
