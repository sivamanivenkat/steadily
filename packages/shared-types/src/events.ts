import { z } from 'zod';
import { AmountMinor, CategoryIdSchema, Confidence, Currency, Id, Timestamp } from './common';
import { CaptureSource, CategorySource, ExtractedFields } from './transaction';

/**
 * Event payloads. Rule: payloads carry ids and extracted fields only, never raw
 * alert text, OCR output or images (D-011). Raw text stays in the inbox table.
 */
export const EventPayloads = {
  /** Native fast path or import wrote a capture. */
  'transaction.captured': z.object({
    inboxId: Id,
    source: CaptureSource,
    extracted: ExtractedFields.partial(),
    quickCategory: z
      .object({ categoryId: CategoryIdSchema, confidence: Confidence, source: CategorySource })
      .optional(),
  }),
  /** Parser produced a complete transaction row. */
  'transaction.parsed': z.object({ transactionId: Id }),
  /** Parser could not extract the minimum fields; inbox item discarded. */
  'transaction.parse_failed': z.object({
    inboxId: Id,
    source: CaptureSource,
    reason: z.string().max(200),
  }),
  'transaction.categorized': z.object({
    transactionId: Id,
    categoryId: CategoryIdSchema,
    confidence: Confidence,
    source: CategorySource,
    needsReview: z.boolean(),
  }),
  'transaction.reconciled': z.object({
    transactionId: Id,
    outcome: z.enum(['new', 'duplicate', 'refund_linked', 'transfer']),
    relatedTransactionId: Id.optional(),
  }),
  /** User changed a category or kind; Categorizer learns a rule from it. */
  'transaction.user_corrected': z.object({
    transactionId: Id,
    previousCategoryId: CategoryIdSchema,
    categoryId: CategoryIdSchema,
    applyToSimilar: z.boolean(),
  }),
  'budget.threshold_crossed': z.object({
    budgetId: Id,
    categoryId: CategoryIdSchema.nullable(),
    percentUsed: z.number().nonnegative(),
    percentOfPeriodElapsed: z.number().min(0).max(100),
  }),
  'subscription.detected': z.object({
    subscriptionId: Id,
    merchantName: z.string().max(200),
    cadence: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
    amountMinor: AmountMinor,
    currency: Currency,
  }),
  'subscription.price_changed': z.object({
    subscriptionId: Id,
    merchantName: z.string().max(200),
    previousAmountMinor: AmountMinor,
    amountMinor: AmountMinor,
    currency: Currency,
  }),
  /** Agents ask; only the Notifier decides what reaches the user (D-012). */
  'notify.request': z.object({
    kind: z.enum([
      'transaction_logged',
      'transaction_needs_review',
      'budget_warning',
      'subscription_price_up',
      'weekly_checkin',
      'daily_summary',
    ]),
    urgency: z.enum(['instant', 'summary']),
    transactionId: Id.optional(),
    budgetId: Id.optional(),
    subscriptionId: Id.optional(),
  }),
  'question.asked': z.object({ questionId: Id }),
  'question.answered': z.object({
    questionId: Id,
    answeredBy: z.enum(['on_device_llm', 'cloud_llm', 'rules']),
  }),
} as const;

export type EventType = keyof typeof EventPayloads;
export const EVENT_TYPES = Object.keys(EventPayloads) as EventType[];

export type EventPayload<T extends EventType> = z.infer<(typeof EventPayloads)[T]>;

/** A persisted event on the bus. */
export type StoredEvent<T extends EventType = EventType> = {
  [K in T]: {
    id: Id;
    type: K;
    at: Timestamp;
    /** Event that caused this one, for tracing and replay. */
    causationId: Id | null;
    payload: EventPayload<K>;
  };
}[T];

/** What an agent emits. The bus assigns id, at and causationId. */
export type NewEvent<T extends EventType = EventType> = {
  [K in T]: { type: K; payload: EventPayload<K> };
}[T];

const EventEnvelope = z.object({
  id: Id,
  type: z.string(),
  at: Timestamp,
  causationId: Id.nullable(),
  payload: z.unknown(),
});

export function isEventType(value: string): value is EventType {
  return Object.hasOwn(EventPayloads, value);
}

/** Validates an unknown value (e.g. a row read from SQLite) as a StoredEvent. */
export function parseStoredEvent(value: unknown): StoredEvent {
  const envelope = EventEnvelope.parse(value);
  if (!isEventType(envelope.type)) throw new Error(`Unknown event type: ${envelope.type}`);
  const payload = EventPayloads[envelope.type].parse(envelope.payload);
  return { ...envelope, type: envelope.type, payload } as StoredEvent;
}

/** Validates an event an agent wants to emit. */
export function parseNewEvent(value: NewEvent): NewEvent {
  if (!isEventType(value.type)) throw new Error(`Unknown event type: ${String(value.type)}`);
  const payload = EventPayloads[value.type].parse(value.payload);
  return { type: value.type, payload } as NewEvent;
}
