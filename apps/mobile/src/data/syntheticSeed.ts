import type { CaptureSource, TransactionKind } from '@steadily/shared-types';
import type { BuiltInCategoryId } from '@steadily/taxonomy';

import type { IssuerId } from './issuers';
import type { IssuerSetupStatus, OnboardingProgress, Settings } from './types';

/**
 * Synthetic demo data. Made-up merchants, people, card endings and amounts: not real accounts or
 * transactions. Dates are relative to "now" so the demo always looks current.
 */

export type SeedTransaction = {
  daysAgo: number;
  /** Local time of day, [hour, minute]. */
  at: readonly [number, number];
  merchant: string;
  /** Merchant text as the alert showed it (a stored field, never the alert itself). */
  raw?: string;
  amountMinor: number;
  category: BuiltInCategoryId;
  kind?: TransactionKind;
  /** Present = the transaction waits in the review queue with these top guesses. */
  review?: readonly BuiltInCategoryId[];
  issuer?: string;
  last4?: string;
  source?: CaptureSource;
  txnRef?: string;
  note?: string;
};

export type SeedSubscription = {
  merchant: string;
  category: BuiltInCategoryId;
  amountMinor: number;
  previousAmountMinor?: number;
  lastChargedDaysAgo: number;
  cadence: 'monthly' | 'yearly';
};

export type SyntheticSeed = {
  transactions: readonly SeedTransaction[];
  /** `category: null` is the overall monthly budget. */
  budgets: readonly { category: BuiltInCategoryId | null; amountMinor: number }[];
  subscriptions: readonly SeedSubscription[];
  issuers?: Partial<Record<IssuerId, { selected: boolean; setupStatus: IssuerSetupStatus }>>;
  onboarding?: Partial<OnboardingProgress>;
  settings?: Partial<Settings>;
};

const CHASE = { issuer: 'chase', last4: '4821' } as const;
const AMEX = { issuer: 'amex', last4: '1007' } as const;
const CAPONE = { issuer: 'capital_one', last4: '3390' } as const;
const CITI = { issuer: 'citi', last4: '2210' } as const;

export const defaultSeed: SyntheticSeed = {
  transactions: [
    // Today
    {
      daysAgo: 0,
      at: [8, 42],
      merchant: 'Blue Bottle Coffee',
      raw: 'SQ *BLUE BOTTLE COFFEE',
      amountMinor: 575,
      category: 'food.coffee',
      ...CHASE,
    },
    {
      daysAgo: 0,
      at: [7, 55],
      merchant: 'Corner Cafe',
      raw: 'TST* CORNER CAFE',
      amountMinor: 1240,
      category: 'food.coffee',
      review: ['food.coffee', 'food.dining', 'food.groceries'],
      ...AMEX,
    },
    // Yesterday
    {
      daysAgo: 1,
      at: [21, 5],
      merchant: 'Uber',
      raw: 'UBER *TRIP',
      amountMinor: 1840,
      category: 'transport.general',
      ...CAPONE,
    },
    {
      daysAgo: 1,
      at: [18, 20],
      merchant: "Trader Joe's",
      raw: 'TRADER JOE S #552',
      amountMinor: 6420,
      category: 'food.groceries',
      ...AMEX,
    },
    {
      daysAgo: 1,
      at: [12, 30],
      merchant: 'Alex M.',
      raw: 'Alex M.',
      amountMinor: 4500,
      category: 'other.general',
      review: ['food.dining', 'entertainment.general', 'transport.general'],
      issuer: 'venmo',
    },
    // Earlier this month
    {
      daysAgo: 2,
      at: [19, 40],
      merchant: 'Amazon',
      raw: 'AMZN Mktp US*2K4',
      amountMinor: 3299,
      category: 'shopping.general',
      review: ['shopping.general', 'gifts.general', 'other.general'],
      ...CITI,
    },
    {
      daysAgo: 2,
      at: [6, 10],
      merchant: 'Netflix',
      raw: 'NETFLIX.COM',
      amountMinor: 1799,
      category: 'subscriptions.general',
      ...CHASE,
    },
    {
      daysAgo: 3,
      at: [12, 15],
      merchant: 'Chipotle',
      raw: 'CHIPOTLE 1873',
      amountMinor: 1365,
      category: 'food.dining',
      ...CHASE,
    },
    {
      daysAgo: 3,
      at: [8, 5],
      merchant: 'Blue Bottle Coffee',
      raw: 'SQ *BLUE BOTTLE COFFEE',
      amountMinor: 575,
      category: 'food.coffee',
      ...CHASE,
    },
    {
      daysAgo: 4,
      at: [17, 30],
      merchant: 'Shell',
      raw: 'SHELL OIL 5744',
      amountMinor: 4210,
      category: 'transport.gas',
      ...CAPONE,
    },
    {
      daysAgo: 5,
      at: [10, 0],
      merchant: 'Jordan P.',
      raw: 'Jordan P.',
      amountMinor: 2000,
      category: 'other.general',
      review: ['food.dining', 'gifts.general', 'entertainment.general'],
      issuer: 'cash_app',
    },
    {
      daysAgo: 5,
      at: [20, 10],
      merchant: 'AMC Theatres',
      raw: 'AMC 4512 ONLINE',
      amountMinor: 3150,
      category: 'entertainment.general',
      ...AMEX,
    },
    {
      daysAgo: 6,
      at: [9, 0],
      merchant: 'CVS Pharmacy',
      raw: 'CVS/PHARMACY #0921',
      amountMinor: 1689,
      category: 'health.general',
      ...CHASE,
    },
    {
      daysAgo: 7,
      at: [11, 20],
      merchant: 'Whole Foods Market',
      raw: 'WHOLEFDS MKT 10213',
      amountMinor: 8735,
      category: 'food.groceries',
      ...AMEX,
    },
    {
      daysAgo: 8,
      at: [19, 15],
      merchant: 'Sephora',
      raw: 'SEPHORA #118',
      amountMinor: 4200,
      category: 'personal_care.general',
      ...CITI,
    },
    {
      daysAgo: 9,
      at: [8, 30],
      merchant: 'Spotify',
      raw: 'Spotify USA',
      amountMinor: 1199,
      category: 'subscriptions.general',
      ...CHASE,
    },
    {
      daysAgo: 10,
      at: [14, 0],
      merchant: 'PG&E',
      raw: 'PGANDE WEB ONLINE',
      amountMinor: 11240,
      category: 'bills.utilities',
      ...CHASE,
      source: 'csv_import',
    },
    {
      daysAgo: 11,
      at: [16, 45],
      merchant: 'Target',
      raw: 'TARGET 00012',
      amountMinor: 5630,
      category: 'shopping.general',
      ...CAPONE,
    },
    {
      daysAgo: 12,
      at: [9, 0],
      merchant: 'Payroll deposit',
      raw: 'ACME CO PAYROLL',
      amountMinor: 245000,
      category: 'other.general',
      kind: 'income',
      ...CHASE,
      source: 'csv_import',
    },
    {
      daysAgo: 13,
      at: [20, 30],
      merchant: 'The Italian Place',
      raw: 'TST* THE ITALIAN PLACE',
      amountMinor: 6890,
      category: 'food.dining',
      ...AMEX,
    },
    {
      daysAgo: 14,
      at: [9, 0],
      merchant: 'Parkside Apartments',
      raw: 'PARKSIDE APTS',
      amountMinor: 185000,
      category: 'housing.rent_mortgage',
      ...CHASE,
      source: 'csv_import',
    },
    // Last month
    {
      daysAgo: 16,
      at: [6, 45],
      merchant: 'Delta Air Lines',
      raw: 'DELTA AIR 0067',
      amountMinor: 28940,
      category: 'travel.general',
      ...AMEX,
    },
    {
      daysAgo: 20,
      at: [18, 0],
      merchant: "Trader Joe's",
      raw: 'TRADER JOE S #552',
      amountMinor: 5512,
      category: 'food.groceries',
      ...AMEX,
    },
    {
      daysAgo: 22,
      at: [12, 40],
      merchant: 'Chipotle',
      raw: 'CHIPOTLE 1873',
      amountMinor: 1190,
      category: 'food.dining',
      ...CHASE,
    },
    {
      daysAgo: 32,
      at: [6, 10],
      merchant: 'Netflix',
      raw: 'NETFLIX.COM',
      amountMinor: 1549,
      category: 'subscriptions.general',
      ...CHASE,
    },
  ],
  budgets: [
    { category: null, amountMinor: 400_000 },
    { category: 'housing.rent_mortgage', amountMinor: 185_000 },
    { category: 'food.groceries', amountMinor: 50_000 },
    { category: 'food.dining', amountMinor: 25_000 },
    { category: 'food.coffee', amountMinor: 4_000 },
    { category: 'transport.general', amountMinor: 15_000 },
    { category: 'shopping.general', amountMinor: 20_000 },
    { category: 'subscriptions.general', amountMinor: 5_000 },
  ],
  subscriptions: [
    {
      merchant: 'Netflix',
      category: 'subscriptions.general',
      amountMinor: 1799,
      previousAmountMinor: 1549,
      lastChargedDaysAgo: 2,
      cadence: 'monthly',
    },
    {
      merchant: 'Spotify',
      category: 'subscriptions.general',
      amountMinor: 1199,
      lastChargedDaysAgo: 9,
      cadence: 'monthly',
    },
  ],
};
