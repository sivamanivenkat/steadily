import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { AppProviders, createSyntheticDataSource, type DataSource } from '@/data';
import type { SyntheticSeed } from '@/data/syntheticSeed';

/** Fixed clock for tests: Thursday, October 15 2026, 9:30 AM local time. */
export const FIXED_NOW = new Date(2026, 9, 15, 9, 30);

export function makeSource(seed?: SyntheticSeed): DataSource {
  return createSyntheticDataSource({ now: () => FIXED_NOW, ...(seed ? { seed } : {}) });
}

/** Renders `ui` inside the app providers with a synthetic data source. */
export async function renderWithData(ui: ReactElement, source: DataSource = makeSource()) {
  const result = await render(<AppProviders source={source}>{ui}</AppProviders>);
  return { ...result, source };
}

/** An empty seed to build focused test data on. */
export const emptySeed: SyntheticSeed = { transactions: [], budgets: [], subscriptions: [] };
