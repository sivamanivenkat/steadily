import type {
  Agent,
  AgentContext,
  EventPayload,
  NewEvent,
  StoredEvent,
  Transaction,
} from '@steadily/shared-types';
import type { Repos } from '../ports';

export const RECONCILER_AGENT_NAME = 'reconciler';

/** Same amount from a different capture source within this window is the same purchase. */
export const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
/** A refund links to a debit at the same merchant at most this far back. */
export const REFUND_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const MERCHANT_HISTORY_LIMIT = 200;

/** Card payments and own-account moves: not spending, not income. */
const TRANSFER_PATTERNS: readonly RegExp[] = [
  /payment\s*-?\s*thank\s*you/i,
  /\bauto\s*-?\s*pay\b/i,
  /\btransfer\s+(to|from)\b/i,
  /\bonline\s+transfer\b/i,
  /\b(credit\s+card|card|online|mobile|ach|e)\s*-?\s*payment\b/i,
  /\bepay\b/i,
];

export interface ReconcilerAgentDeps {
  repos: Pick<Repos, 'transactions'>;
}

type Outcome = EventPayload<'transaction.reconciled'>['outcome'];

/**
 * Reconciler (D-017). For each categorized transaction, in order:
 * 1. Duplicate: same (issuerId, txnRef), or same amount and kind within ±5 minutes from
 *    a different capture source. The newer row is soft-deleted and linked to the kept one.
 * 2. Refund: a credit with an earlier, not yet fully refunded debit at the same merchant
 *    (same or larger amount, within 90 days) is linked to it and becomes kind `refund`.
 * 3. Transfer: card payments and own-account transfers become kind `transfer`.
 * 4. Otherwise `new`.
 *
 * Then it asks the Notifier: needs-review rows instantly, confirmed rows in the summary.
 * Duplicates are never announced.
 */
export function createReconcilerAgent(deps: ReconcilerAgentDeps): Agent {
  const { transactions } = deps.repos;

  async function findDuplicateOf(tx: Transaction): Promise<Transaction | null> {
    if (tx.txnRef !== null) {
      const sameRef = await transactions.findByTxnRef(tx.issuerId, tx.txnRef);
      const kept = sameRef.filter((other) => isOlder(other, tx)).sort(byAge)[0];
      if (kept) return kept;
    }
    const at = Date.parse(tx.occurredAt);
    const nearby = await transactions.findInWindow({
      from: new Date(at - DUPLICATE_WINDOW_MS).toISOString(),
      to: new Date(at + DUPLICATE_WINDOW_MS).toISOString(),
      amountMinor: tx.amountMinor,
    });
    return (
      nearby
        .filter(
          (other) =>
            isOlder(other, tx) &&
            other.source !== tx.source &&
            other.kind === tx.kind &&
            other.currency === tx.currency &&
            compatible(other.accountLast4, tx.accountLast4) &&
            compatible(other.issuerId, tx.issuerId) &&
            // Two distinct issuer references are two distinct purchases.
            (other.txnRef === null || tx.txnRef === null),
        )
        .sort(byAge)[0] ?? null
    );
  }

  async function findRefundedDebit(tx: Transaction): Promise<Transaction | null> {
    if (tx.kind !== 'refund' && tx.kind !== 'income') return null;
    if (!tx.merchantName) return null;
    const at = Date.parse(tx.occurredAt);
    const earliest = at - REFUND_WINDOW_MS;
    const history = await transactions.listByMerchant(tx.merchantName, MERCHANT_HISTORY_LIMIT);

    const refundedSoFar = new Map<string, number>();
    for (const other of history) {
      if (other.id === tx.id || other.kind !== 'refund' || !other.linkedTransactionId) continue;
      const id = other.linkedTransactionId;
      refundedSoFar.set(id, (refundedSoFar.get(id) ?? 0) + other.amountMinor);
    }

    const candidates = history.filter((other) => {
      if (other.id === tx.id || other.kind !== 'expense' || other.currency !== tx.currency) {
        return false;
      }
      const otherAt = Date.parse(other.occurredAt);
      if (otherAt > at || otherAt < earliest) return false;
      const remaining = other.amountMinor - (refundedSoFar.get(other.id) ?? 0);
      return remaining >= tx.amountMinor;
    });
    // Exact amount first, then the most recent purchase.
    candidates.sort(
      (a, b) =>
        Number(b.amountMinor === tx.amountMinor) - Number(a.amountMinor === tx.amountMinor) ||
        b.occurredAt.localeCompare(a.occurredAt),
    );
    return candidates[0] ?? null;
  }

  async function reconcile(event: StoredEvent<'transaction.categorized'>, ctx: AgentContext) {
    const tx = await transactions.get(event.payload.transactionId);
    if (!tx || tx.deletedAt !== null) return [];
    const now = ctx.now().toISOString();

    const kept = await findDuplicateOf(tx);
    if (kept) {
      await transactions.update(tx.id, {
        deletedAt: now,
        updatedAt: now,
        linkedTransactionId: kept.id,
      });
      return [reconciled(tx.id, 'duplicate', kept.id)];
    }

    let outcome: Outcome = 'new';
    let relatedId: string | undefined;

    const original = await findRefundedDebit(tx);
    if (original) {
      await transactions.update(tx.id, {
        kind: 'refund',
        linkedTransactionId: original.id,
        updatedAt: now,
      });
      outcome = 'refund_linked';
      relatedId = original.id;
    } else if (tx.kind === 'transfer' || looksLikeTransfer(tx)) {
      // Transfers are not spending, so there is no category to review.
      await transactions.update(tx.id, { kind: 'transfer', status: 'confirmed', updatedAt: now });
      outcome = 'transfer';
    }

    const current = (await transactions.get(tx.id)) ?? tx;
    return [reconciled(tx.id, outcome, relatedId), notifyFor(current)];
  }

  return {
    name: RECONCILER_AGENT_NAME,
    subscribes: ['transaction.categorized'],
    async handle(event, ctx) {
      if (event.type !== 'transaction.categorized') return [];
      return reconcile(event, ctx);
    },
  };
}

export function looksLikeTransfer(tx: Pick<Transaction, 'merchantRaw' | 'merchantName'>): boolean {
  const texts = [tx.merchantRaw, tx.merchantName].filter((t): t is string => !!t);
  return texts.some((text) => TRANSFER_PATTERNS.some((pattern) => pattern.test(text)));
}

function reconciled(transactionId: string, outcome: Outcome, relatedTransactionId?: string) {
  const payload: EventPayload<'transaction.reconciled'> = relatedTransactionId
    ? { transactionId, outcome, relatedTransactionId }
    : { transactionId, outcome };
  return { type: 'transaction.reconciled', payload } satisfies NewEvent;
}

function notifyFor(tx: Transaction): NewEvent {
  return tx.status === 'needs_review'
    ? {
        type: 'notify.request',
        payload: { kind: 'transaction_needs_review', urgency: 'instant', transactionId: tx.id },
      }
    : {
        type: 'notify.request',
        payload: { kind: 'transaction_logged', urgency: 'summary', transactionId: tx.id },
      };
}

/** Kept row = created first (ties broken by id), so replays pick the same one. */
function isOlder(other: Transaction, tx: Transaction): boolean {
  if (other.id === tx.id) return false;
  return byAge(other, tx) < 0;
}

function byAge(a: Transaction, b: Transaction): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/** Two optional identifiers agree unless both are present and differ. */
function compatible(a: string | null, b: string | null): boolean {
  return a === null || b === null || a === b;
}
