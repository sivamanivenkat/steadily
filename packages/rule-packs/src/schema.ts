import { z } from 'zod';
import { ExtractedFields, Timestamp } from '@steadily/shared-types';

/** Named capture groups a rule pattern may use. `amount` is required. */
export const ALLOWED_GROUPS = [
  'amount',
  'merchant',
  'last4',
  'direction',
  'date',
  'txnRef',
] as const;
export type AllowedGroup = (typeof ALLOWED_GROUPS)[number];

/** Issuer id of the brand-agnostic fallback pack. Its matches carry no issuerId. */
export const GENERIC_ISSUER_ID = 'generic';

export const RuleChannel = z.enum(['push', 'sms', 'any']);
export type RuleChannel = z.infer<typeof RuleChannel>;

export const Direction = z.enum(['debit', 'credit']);
export type Direction = z.infer<typeof Direction>;

export const Rule = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,64}$/),
  channel: RuleChannel,
  /** Portable regex source (see README). Matched case-insensitively against normalized text. */
  pattern: z.string().min(1).max(2000),
  /** Default direction; a `direction` capture group can override it. */
  direction: Direction,
});
export type Rule = z.infer<typeof Rule>;

export const RulePack = z.object({
  issuerId: z.string().regex(/^[a-z0-9_]{1,50}$/),
  displayName: z.string().min(1).max(100),
  /** Monotonic integer; bump on every change so packs can be updated over the air. */
  version: z.number().int().positive(),
  /** True only after the rules were checked against real (redacted) alerts. */
  verified: z.boolean(),
  sources: z.object({
    androidPackages: z.array(z.string().min(1)),
    smsSenders: z.array(z.string().min(1)),
  }),
  /** If any of these patterns matches, this pack yields no result for the alert. */
  exclude: z.array(z.string().min(1).max(500)).optional(),
  rules: z.array(Rule).min(1),
});
export type RulePack = z.infer<typeof RulePack>;

export const AlertInput = z.object({
  text: z.string(),
  receivedAt: Timestamp,
  /** CaptureSource, e.g. "android_notification" or "ios_sms_shortcut". */
  source: z.string().optional(),
  androidPackage: z.string().optional(),
  smsSender: z.string().optional(),
});
export type AlertInput = z.infer<typeof AlertInput>;

/** One shared fixture case, run by the TS, Swift and Kotlin parsers alike. */
export const Fixture = z.object({
  name: z.string().min(1),
  input: AlertInput,
  expected: ExtractedFields.nullable(),
});
export type Fixture = z.infer<typeof Fixture>;
