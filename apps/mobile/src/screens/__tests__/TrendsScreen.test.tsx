import { fireEvent, screen } from '@testing-library/react-native';

import type { SyntheticSeed } from '@/data/syntheticSeed';
import { emptySeed, makeSource, renderWithData } from '@/testing/render';
import { mockRouter, resetRouter } from '@/testing/router';

import { BudgetsScreen } from '../BudgetsScreen';
import { HomeScreen } from '../HomeScreen';
import { chartSummary, deltaLabel, TrendsScreen } from '../TrendsScreen';

jest.mock('expo-router', () => require('@/testing/router').routerModule);

/**
 * October 15. October: groceries $64.20 + coffee 2 x $5.75 = $75.70 (the income does not count).
 * September: dining $30. August: shopping $100.
 */
const seed: SyntheticSeed = {
  ...emptySeed,
  transactions: [
    {
      daysAgo: 1,
      at: [8, 0],
      merchant: 'Blue Bottle Coffee',
      amountMinor: 575,
      category: 'food.coffee',
    },
    {
      daysAgo: 2,
      at: [18, 0],
      merchant: "Trader Joe's",
      amountMinor: 6_420,
      category: 'food.groceries',
    },
    {
      daysAgo: 3,
      at: [8, 0],
      merchant: 'Blue Bottle Coffee',
      amountMinor: 575,
      category: 'food.coffee',
    },
    {
      daysAgo: 4,
      at: [9, 0],
      merchant: 'Payroll',
      amountMinor: 200_000,
      category: 'other.general',
      kind: 'income',
    },
    { daysAgo: 20, at: [12, 0], merchant: 'Chipotle', amountMinor: 3_000, category: 'food.dining' },
    {
      daysAgo: 50,
      at: [12, 0],
      merchant: 'Target',
      amountMinor: 10_000,
      category: 'shopping.general',
    },
  ],
};

describe('TrendsScreen', () => {
  beforeEach(resetRouter);

  it('shows the month total against last month, categories and top merchants', async () => {
    await renderWithData(<TrendsScreen />, makeSource(seed));

    expect(await screen.findByText('$75.70')).toBeOnTheScreen();
    expect(screen.getByText('October 2026')).toBeOnTheScreen();
    expect(screen.getByText('Spent in October')).toBeOnTheScreen();
    expect(screen.getByText('On-device')).toBeOnTheScreen();
    expect(screen.getByLabelText('Spent in October: 75 dollars and 70 cents')).toBeOnTheScreen();
    expect(screen.getByText('$45.70 more than September')).toBeOnTheScreen();
    expect(screen.getByLabelText('45 dollars and 70 cents more than September')).toBeOnTheScreen();

    expect(
      screen.getByRole('button', {
        name: 'Groceries: 64 dollars and 20 cents, 85 percent of spending',
      }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', {
        name: 'Coffee: 11 dollars and 50 cents, 15 percent of spending',
      }),
    ).toBeOnTheScreen();
    expect(screen.getByText('85% of spending')).toBeOnTheScreen();

    expect(
      screen.getByLabelText("Trader Joe's: 64 dollars and 20 cents, 1 purchase"),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Blue Bottle Coffee: 11 dollars and 50 cents, 2 purchases'),
    ).toBeOnTheScreen();
    expect(screen.queryByText('Payroll')).toBeNull();
  });

  it('summarizes the chart as text and lets each month be picked', async () => {
    await renderWithData(<TrendsScreen />, makeSource(seed));

    expect(await screen.findByText('About $68.57 a month · highest in August')).toBeOnTheScreen();
    expect(
      screen.getByLabelText(
        'About 68 dollars and 57 cents a month on average. Highest in August, 100 dollars.',
      ),
    ).toBeOnTheScreen();
    const october = screen.getByRole('button', { name: 'October 2026: 75 dollars and 70 cents' });
    expect(october).toBeSelected();

    await fireEvent.press(screen.getByRole('button', { name: 'August 2026: 100 dollars' }));
    expect(await screen.findByText('Spent in August')).toBeOnTheScreen();
    expect(screen.getByText('August 2026')).toBeOnTheScreen();
    expect(screen.getByText('$100 more than July')).toBeOnTheScreen();
  });

  it('steps through this month and the 11 before it', async () => {
    await renderWithData(<TrendsScreen />, makeSource(seed));
    await screen.findByText('$75.70');

    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Previous month' }));
    expect(await screen.findByText('Spent in September')).toBeOnTheScreen();
    expect(screen.getByText('$30')).toBeOnTheScreen();
    expect(screen.getByText('$70 less than August')).toBeOnTheScreen();

    for (let i = 0; i < 10; i++) {
      await fireEvent.press(screen.getByRole('button', { name: 'Previous month' }));
    }
    expect(await screen.findByText('November 2025')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled();
    expect(await screen.findByText('Nothing logged in November 2025')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Next month' }));
    expect(await screen.findByText('December 2025')).toBeOnTheScreen();
  });

  it('opens Activity filtered to a category', async () => {
    await renderWithData(<TrendsScreen />, makeSource(seed));
    await fireEvent.press(await screen.findByRole('button', { name: /^Groceries:/ }));
    expect(mockRouter.navigate).toHaveBeenCalledWith({
      pathname: '/activity',
      params: { category: 'food.groceries', since: new Date(2026, 9, 1).toISOString() },
    });
  });

  it('explains an empty history', async () => {
    await renderWithData(<TrendsScreen />, makeSource(emptySeed));
    expect(await screen.findByText('No spending to compare yet')).toBeOnTheScreen();
  });

  it('shows a loading state until the numbers are in', async () => {
    const source = makeSource(seed);
    await renderWithData(<TrendsScreen />, { ...source, getTrends: () => new Promise(() => {}) });
    expect(await screen.findByText('Adding up October…')).toBeOnTheScreen();
  });

  it('goes back', async () => {
    await renderWithData(<TrendsScreen />, makeSource(seed));
    await fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
    expect(mockRouter.back).toHaveBeenCalled();
  });
});

describe('Trends entry points', () => {
  beforeEach(resetRouter);

  it('opens from Home', async () => {
    await renderWithData(<HomeScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Spending trends' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/trends');
  });

  it('opens from Budgets', async () => {
    await renderWithData(<BudgetsScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'See spending trends' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/trends');
  });
});

describe('trend labels', () => {
  it('describes the change from last month', () => {
    expect(deltaLabel(0, 0, 'September')).toBeNull();
    expect(deltaLabel(5_000, 5_000, 'September')?.text).toBe('Same as September');
    expect(deltaLabel(2_500, 5_000, 'September')).toEqual({
      text: '$25 less than September',
      spoken: '25 dollars less than September',
      direction: 'down',
    });
  });

  it('summarizes months with no spending', () => {
    expect(chartSummary([]).text).toBe('Nothing logged yet');
  });
});
