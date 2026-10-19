import { z } from 'zod';
import { CategoryIdSchema, Confidence, ExtractedFields, Id } from '@steadily/shared-types';

/**
 * One capture the Android fast path staged on the device. It carries extracted fields only:
 * the notification title and text are discarded before this record is written (D-011).
 * Shaped like the `transaction.captured` event payload so the agent runtime can adopt it.
 */
export const PendingCapture = z.object({
  /** Schema version of this record. */
  v: z.literal(1),
  /** Becomes the `inboxId` of the `transaction.captured` event. */
  id: Id,
  source: z.literal('android_notification'),
  /** When the fast path wrote the record. */
  capturedAt: z.iso.datetime({ offset: true }),
  extracted: ExtractedFields,
  /** Normalized merchant display name, e.g. "Blue Bottle Coffee". */
  merchantName: z.string().max(200).optional(),
  quickCategory: z
    .object({
      categoryId: CategoryIdSchema,
      confidence: Confidence,
      source: z.literal('dictionary'),
    })
    .optional(),
});
export type PendingCapture = z.infer<typeof PendingCapture>;

export const CaptureHealth = z.object({
  /** True when the user granted Steadily notification access. */
  listenerEnabled: z.boolean(),
  /** Epoch ms of the last allow-listed alert that was seen, or null if none yet. */
  lastAlertSeenAt: z.number().int().nonnegative().nullable(),
  /** Epoch ms of the last alert that produced a staged capture, or null. */
  lastCaptureAt: z.number().int().nonnegative().nullable(),
  /** True when the system exempts Steadily from battery optimization. */
  ignoringBatteryOptimizations: z.boolean(),
  /** Lowercase device manufacturer, e.g. "oneplus", "xiaomi", "samsung". */
  manufacturer: z.string(),
  pendingCount: z.number().int().nonnegative(),
});
export type CaptureHealth = z.infer<typeof CaptureHealth>;

/** What the native module returns for `peekPending`: JSON strings, validated here. */
export const PendingBatch = z.array(z.string());

/** Payload of the `onPendingCapture` event. Carries a count only, never capture contents. */
export const PendingCaptureEvent = z.object({
  pendingCount: z.number().int().nonnegative(),
});
export type PendingCaptureEvent = z.infer<typeof PendingCaptureEvent>;
