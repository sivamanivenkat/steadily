import type { CategoryId } from '@steadily/taxonomy';

import type { IssuerId } from './issuers';
import type {
  AskTurn,
  Budget,
  BudgetInput,
  BudgetWithSpent,
  DateRange,
  IssuerSetup,
  IssuerSetupStatus,
  ManualAddResult,
  ManualTransactionInput,
  OnboardingProgress,
  PrivacySummary,
  ReviewItem,
  Settings,
  SubscriptionSummary,
  Transaction,
} from './types';

/**
 * Everything the screens read and write. The app uses `createRepoDataSource` (packages/db
 * repositories and the agent-core runtime); tests mostly use the in-memory
 * `createSyntheticDataSource`.
 *
 * Methods are async like the repositories. Implementations call `subscribe` listeners after
 * every write so screens can reload.
 */
export interface DataSource {
  /** Current time. Injectable so demo data and tests are stable. */
  now(): Date;
  subscribe(listener: () => void): () => void;

  // Transactions
  /** Non-deleted transactions with occurredAt in `[from, to)`, newest first. */
  listTransactions(range: DateRange): Promise<Transaction[]>;
  getTransaction(id: string): Promise<Transaction | null>;
  /** The review queue, oldest first so it reads like an inbox. */
  listNeedsReview(): Promise<ReviewItem[]>;
  /**
   * The user picked a category. Confirms the transaction; with `applyToSimilar`, also remembers
   * the choice for this merchant (a local rule) and applies it to other queued transactions from
   * the same merchant.
   */
  confirmCategory(id: string, categoryId: CategoryId, applyToSimilar: boolean): Promise<void>;
  /** Not spending (e.g. moving money between own accounts): kept, but excluded from budgets. */
  markNotExpense(id: string): Promise<void>;
  setNote(id: string, note: string | null): Promise<void>;
  /**
   * Logs a transaction the user typed in. Runs through the same pipeline as captures (source
   * `manual`, category chosen by the user), so duplicates of an alert already logged are caught.
   */
  addManualTransaction(input: ManualTransactionInput): Promise<ManualAddResult>;

  // Budgets
  /** Active budgets with spending in `range`. The overall budget (categoryId null) comes first. */
  listBudgets(range: DateRange): Promise<BudgetWithSpent[]>;
  /** Creates or replaces the budget for a category (or the overall one). */
  setBudget(input: BudgetInput): Promise<Budget>;
  deleteBudget(id: string): Promise<void>;

  // Subscriptions
  listSubscriptions(): Promise<SubscriptionSummary[]>;

  // Issuers and onboarding (D-014). Stored on this phone only.
  listIssuerSetup(): Promise<IssuerSetup[]>;
  /** Replaces the picked set. Newly picked issuers start as `pending`. */
  setSelectedIssuers(ids: readonly IssuerId[]): Promise<void>;
  setIssuerSetupStatus(id: IssuerId, status: IssuerSetupStatus): Promise<void>;
  getOnboarding(): Promise<OnboardingProgress>;
  saveOnboarding(patch: Partial<OnboardingProgress>): Promise<OnboardingProgress>;

  // Settings
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;

  /**
   * Answers a question about the user's money (Ask tab). Rules on this phone by default; a cloud
   * model only when the user opted in and the build is configured for it. Optional: sources
   * without an engine leave it out and the Ask tab says so.
   */
  ask?: (question: string) => Promise<AskTurn>;

  // Privacy (D-011)
  /** Counts for the Privacy screen. Optional: sources without it show no counts. */
  getPrivacySummary?: () => Promise<PrivacySummary>;
  /**
   * Deletes everything Steadily stored on this phone: the database (on a device also its
   * encryption key) and captures still staged by the native capture layer. Afterwards the app
   * starts over at onboarding. Optional: absent where there is nothing to delete.
   */
  deleteAllData?: () => Promise<void>;

  /**
   * Development only: runs synthetic sample alerts through the capture pipeline and returns how
   * many were captured. Absent in production builds and in the synthetic source.
   */
  seedSampleData?: () => Promise<number>;
}
