import {
  AUTO_SAVE_CONFIDENCE,
  type Agent,
  type ExtractedFields,
  type NewEvent,
  type StoredEvent,
  type Transaction,
  type TransactionKind,
} from '@steadily/shared-types';
import { lookupMerchant, normalizeMerchant } from '@steadily/merchants';
import { BUILT_IN_PACKS, parseAlert, type RulePack } from '@steadily/rule-packs';
import { FALLBACK_CATEGORY_ID } from '@steadily/taxonomy';
import type { InboxItem, Repos } from '../ports';

export const PARSER_AGENT_NAME = 'parser';

/** Peer-to-peer apps: money received there is usually a friend paying back. */
export const P2P_ISSUER_IDS: ReadonlySet<string> = new Set([
  'venmo',
  'cash_app',
  'zelle',
  'paypal',
]);

const DEFAULT_CURRENCY = 'USD';

export interface ParserAgentDeps {
  repos: Pick<Repos, 'transactions' | 'inbox'>;
  /** Rule packs for the TypeScript parse path. Defaults to the bundled packs. */
  packs?: readonly RulePack[];
}

type Captured = StoredEvent<'transaction.captured'>;
type Merged = Partial<ExtractedFields>;

/**
 * Parser (D-017): turns a `transaction.captured` event plus its inbox item into a
 * stored Transaction and emits `transaction.parsed`.
 *
 * - Fields on the event (native fast path) win; `parseAlert` on the raw text fills the gaps.
 * - The transaction id is the inbox id, so a re-delivered capture finds its own
 *   transaction and never creates a second one.
 * - Raw text is read here and nowhere else. It never reaches an event, a log line or
 *   an error message (D-011); the inbox item is deleted once parsing finishes.
 *
 * Kind rules: debit -> expense. Credit at a dictionary merchant -> refund. Credit from
 * a P2P app (Venmo, Cash App...) -> transfer, because friends paying you back is not
 * income (BUILD_PLAN 3.1 "P2P received" is a transfer). Any other credit -> income.
 */
export function createParserAgent(deps: ParserAgentDeps): Agent {
  const { repos } = deps;
  const packs = deps.packs ?? BUILT_IN_PACKS;

  return {
    name: PARSER_AGENT_NAME,
    subscribes: ['transaction.captured'],
    async handle(event, ctx) {
      if (event.type !== 'transaction.captured') return [];
      const { inboxId, source } = event.payload;

      const [item, existing] = await Promise.all([
        repos.inbox.get(inboxId),
        repos.transactions.get(inboxId),
      ]);

      if (existing) {
        // Already parsed. If the inbox item survived a crash, finish the job.
        if (!item) return [];
        await repos.inbox.delete(inboxId);
        return [parsedEvent(existing.id)];
      }

      const merged = mergeFields(event, item, packs);
      const missing = missingFields(merged);
      if (missing.length > 0) {
        if (item) await repos.inbox.delete(inboxId);
        ctx.log.info('Capture could not be parsed', {
          agent: PARSER_AGENT_NAME,
          eventId: event.id,
        });
        return [
          {
            type: 'transaction.parse_failed',
            payload: { inboxId, source, reason: `missing fields: ${missing.join(', ')}` },
          },
        ];
      }

      const now = ctx.now().toISOString();
      const tx = buildTransaction(event, merged as RequiredFields & Merged, now);
      await repos.transactions.insert(tx);
      if (item) await repos.inbox.delete(inboxId);
      return [parsedEvent(tx.id)];
    },
  };
}

type RequiredFields = Pick<ExtractedFields, 'amountMinor' | 'direction' | 'occurredAt'>;

function parsedEvent(transactionId: string): NewEvent {
  return { type: 'transaction.parsed', payload: { transactionId } };
}

/** Rule-pack parse of the inbox text, overlaid with the fields the event already carries. */
function mergeFields(event: Captured, item: InboxItem | null, packs: readonly RulePack[]): Merged {
  let fromText: Merged = {};
  if (item) {
    try {
      fromText =
        parseAlert(
          {
            text: item.rawText,
            receivedAt: item.createdAt,
            source: item.source,
            // The origin lets a pack claim the alert, so its app-specific push rules run.
            ...(item.originApp ? { androidPackage: item.originApp } : {}),
            ...(item.originSender ? { smsSender: item.originSender } : {}),
          },
          packs,
        ) ?? {};
    } catch {
      // Invalid input shape (e.g. a bad timestamp). The error is dropped on purpose:
      // its message could echo the alert text.
      fromText = {};
    }
  }
  const fromEvent = Object.fromEntries(
    Object.entries(event.payload.extracted).filter(([, value]) => value !== undefined),
  ) as Merged;
  return { ...fromText, ...fromEvent };
}

function missingFields(fields: Merged): string[] {
  const missing: string[] = [];
  if (fields.amountMinor === undefined) missing.push('amount');
  if (fields.direction === undefined) missing.push('direction');
  if (fields.occurredAt === undefined) missing.push('occurredAt');
  return missing;
}

export function kindFor(
  direction: ExtractedFields['direction'],
  issuerId: string | undefined,
  knownMerchant: boolean,
): TransactionKind {
  if (direction === 'debit') return 'expense';
  if (issuerId !== undefined && P2P_ISSUER_IDS.has(issuerId)) return 'transfer';
  return knownMerchant ? 'refund' : 'income';
}

function buildTransaction(
  event: Captured,
  fields: RequiredFields & Merged,
  now: string,
): Transaction {
  const merchant = fields.merchantRaw ? normalizeMerchant(fields.merchantRaw) : null;
  const merchantName = merchant && merchant.name ? merchant.name : null;
  const knownMerchant = !!merchant?.key && lookupMerchant(merchant.key) !== undefined;
  const quick = event.payload.quickCategory;

  return {
    id: event.payload.inboxId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    occurredAt: fields.occurredAt,
    amountMinor: fields.amountMinor,
    currency: fields.currency ?? DEFAULT_CURRENCY,
    kind: kindFor(fields.direction, fields.issuerId, knownMerchant),
    merchantRaw: fields.merchantRaw ?? null,
    merchantName,
    // Provisional: the Categorizer runs next and overwrites these.
    categoryId: quick?.categoryId ?? FALLBACK_CATEGORY_ID,
    categoryConfidence: quick?.confidence ?? 0,
    categorySource: quick?.source ?? 'none',
    status: quick && quick.confidence >= AUTO_SAVE_CONFIDENCE ? 'confirmed' : 'needs_review',
    source: event.payload.source,
    accountLast4: fields.accountLast4 ?? null,
    issuerId: fields.issuerId ?? null,
    txnRef: fields.txnRef ?? null,
    note: null,
    linkedTransactionId: null,
  };
}
