/**
 * Data shapes the app reads and writes. Stored records reuse the contract types
 * (`Transaction`, `Settings` from @steadily/shared-types; `Budget`, `Subscription` from the
 * agent-core ports) so the synthetic source can be swapped for the real repositories.
 * App-only shapes (onboarding progress, issuer setup) are defined here until they get a home in
 * packages/db.
 */
import type { Budget, Subscription } from '@steadily/agent-core';
import type { Settings, Transaction } from '@steadily/shared-types';
import type { BuiltInCategoryId, CategoryId } from '@steadily/taxonomy';

import type { IssuerId } from './issuers';

export type { Budget, Settings, Subscription, Transaction };

/** Half-open time range `[from, to)`, ISO timestamps. */
export type DateRange = { from: string; to: string };

/** A transaction waiting in the review queue, with the categorizer's best guesses. */
export type ReviewItem = {
  transaction: Transaction;
  /** Top guesses, best first (up to 3). */
  suggestedCategoryIds: BuiltInCategoryId[];
};

/** How a payment to a person was used (P2P prompt, D-009). */
export type P2PPurpose = 'split_bill' | 'paying_back' | 'rent' | 'gift';

export type BudgetWithSpent = {
  budget: Budget;
  /** Spending in the requested range: expenses minus refunds, transfers and income excluded. */
  spentMinor: number;
};

export type SubscriptionSummary = {
  subscription: Subscription;
  /** Previous charge amount when the price changed, else null. */
  previousAmountMinor: number | null;
};

/** Where the user is with setting up alerts for one issuer (D-014). */
export type IssuerSetupStatus = 'pending' | 'done' | 'skipped';

export type IssuerSetup = {
  issuerId: IssuerId;
  /** Picked in onboarding. Stored on this phone only. */
  selected: boolean;
  setupStatus: IssuerSetupStatus;
  /** Last captured alert from this issuer (derived from stored transactions). */
  lastAlertAt: string | null;
};

/** What Settings shows per issuer (D-014). */
export type IssuerHealth = 'receiving' | 'quiet' | 'waiting' | 'not_set_up';

export type OnboardingStep = 'welcome' | 'issuers' | 'setup' | 'connect' | 'battery' | 'waiting';

export type OnboardingProgress = {
  completed: boolean;
  /** Last step the user was on, so onboarding resumes there. */
  step: OnboardingStep;
};

/** One question and its answer in the Ask tab. Kept in memory only. */
export type AskTurn = {
  id: string;
  question: string;
  text: string;
  /** Where the answer was worked out: rules and on-device model stay on the phone. */
  answeredBy: 'rules' | 'on_device_llm' | 'cloud_llm';
  /** ISO timestamp. */
  at: string;
};

export type BudgetInput = { categoryId: CategoryId | null; amountMinor: number };

/** What the user can log by hand. Transfers are marked from a transaction instead. */
export type ManualKind = 'expense' | 'income' | 'refund';

/** A transaction typed in on the Add screen. */
export type ManualTransactionInput = {
  /** Positive integer cents. */
  amountMinor: number;
  merchant: string;
  categoryId: CategoryId;
  /** ISO timestamp. */
  occurredAt: string;
  kind: ManualKind;
  note: string | null;
};

export type ManualAddResult = {
  /** The saved transaction, or the already logged one it matched. */
  transactionId: string;
  /** True when it matched one already captured (e.g. from a bank alert), which was kept. */
  duplicate: boolean;
};
