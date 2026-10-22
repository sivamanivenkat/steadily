import { act, fireEvent, screen } from '@testing-library/react-native';

import { createSyntheticDataSource } from '@/data';
import type { SyntheticSeed } from '@/data/syntheticSeed';
import { emptySeed, FIXED_NOW, makeSource, renderWithData } from '@/testing/render';
import { mockRouter, resetRouter } from '@/testing/router';

import { HomeScreen } from '../HomeScreen';

jest.mock('expo-router', () => require('@/testing/router').routerModule);

describe('HomeScreen', () => {
  beforeEach(resetRouter);

  it('renders the synthetic home data', async () => {
    await renderWithData(<HomeScreen />);

    expect(await screen.findByText('$1,444.44')).toBeOnTheScreen();
    expect(screen.getByText('Good morning')).toBeOnTheScreen();
    expect(screen.getByText('Thursday, October 15')).toBeOnTheScreen();
    expect(screen.getByText('until Oct 31 · about $84.96 a day')).toBeOnTheScreen();
    expect(screen.getByText('64% spent')).toBeOnTheScreen();
    expect(screen.getByText('46% of month')).toBeOnTheScreen();
    expect(screen.getByText('A little ahead')).toBeOnTheScreen();
    expect(screen.getByText('4 to review')).toBeOnTheScreen();

    expect(screen.getByText('Blue Bottle Coffee')).toBeOnTheScreen();
    expect(screen.getByText('$5.75')).toBeOnTheScreen();
    expect(screen.getByText('Corner Cafe')).toBeOnTheScreen();
    expect(screen.getByText('Needs review')).toBeOnTheScreen();
    expect(screen.getByText("Trader Joe's")).toBeOnTheScreen();
    expect(screen.getByText('Uber')).toBeOnTheScreen();
  });

  it('labels icon-only controls and reads amounts as currency', async () => {
    await renderWithData(<HomeScreen />);
    await screen.findByText('$1,444.44');

    await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings');

    expect(screen.getByLabelText('Safe to spend: 1,444 dollars and 44 cents')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Blue Bottle Coffee, 5 dollars and 75 cents, Coffee, 8:42 AM'),
    ).toBeOnTheScreen();
    expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ now: 64 });
  });

  it('opens the review queue from the review row', async () => {
    await renderWithData(<HomeScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: '4 transactions to review' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/review');
  });

  it('updates the review count after a transaction is confirmed', async () => {
    const source = makeSource();
    await renderWithData(<HomeScreen />, source);
    await screen.findByText('4 to review');

    const [first] = await source.listNeedsReview();
    await act(() => source.markNotExpense(first!.transaction.id));
    expect(await screen.findByText('3 to review')).toBeOnTheScreen();
  });

  it('shows the price increase badge on the latest subscription charge', async () => {
    const source = makeSource({
      transactions: [
        {
          daysAgo: 0,
          at: [6, 0],
          merchant: 'Netflix',
          amountMinor: 1799,
          category: 'subscriptions.general',
        },
      ],
      budgets: [],
      subscriptions: [
        {
          merchant: 'Netflix',
          category: 'subscriptions.general',
          amountMinor: 1799,
          previousAmountMinor: 1549,
          lastChargedDaysAgo: 0,
          cadence: 'monthly',
        },
      ],
    });
    await renderWithData(<HomeScreen />, source);
    expect(await screen.findByText('Price up $2.50')).toBeOnTheScreen();
    expect(screen.getByText("See what's safe to spend")).toBeOnTheScreen();
  });

  describe('with category budgets only', () => {
    const seed: SyntheticSeed = {
      ...emptySeed,
      transactions: [
        {
          daysAgo: 1,
          at: [12, 0],
          merchant: 'Corner Bistro',
          amountMinor: 6_000,
          category: 'food.dining',
        },
        {
          daysAgo: 2,
          at: [8, 0],
          merchant: 'Bean Bar',
          amountMinor: 4_500,
          category: 'food.coffee',
        },
        // Not budgeted: left out of the derived total.
        {
          daysAgo: 2,
          at: [18, 0],
          merchant: 'Green Grocer',
          amountMinor: 3_000,
          category: 'food.groceries',
        },
      ],
      budgets: [
        { category: 'food.dining', amountMinor: 20_000 },
        { category: 'food.coffee', amountMinor: 5_000 },
        { category: 'transport.general', amountMinor: 10_000 },
        { category: 'shopping.general', amountMinor: 10_000 },
      ],
    };

    it('derives safe to spend from the category budgets and says so', async () => {
      await renderWithData(<HomeScreen />, makeSource(seed));
      // 450 budgeted - 105 spent in those categories.
      expect(await screen.findByText('$345')).toBeOnTheScreen();
      expect(screen.getByText('Based on your category budgets')).toBeOnTheScreen();
      expect(screen.getByText('Budgeted categories this month')).toBeOnTheScreen();
      expect(screen.queryByText("See what's safe to spend")).toBeNull();
    });

    it('shows the three most used budgets and links to all of them', async () => {
      await renderWithData(<HomeScreen />, makeSource(seed));
      expect(
        await screen.findByLabelText('Coffee: spent 45 dollars of 50 dollars, 5 dollars left'),
      ).toBeOnTheScreen();
      expect(
        screen.getByLabelText('Dining Out: spent 60 dollars of 200 dollars, 140 dollars left'),
      ).toBeOnTheScreen();
      expect(screen.getByLabelText(/^Transport: /)).toBeOnTheScreen();
      expect(screen.queryByLabelText(/^Shopping: /)).toBeNull();

      await fireEvent.press(screen.getByRole('button', { name: 'See all budgets' }));
      expect(mockRouter.navigate).toHaveBeenCalledWith('/budgets');
      await fireEvent.press(screen.getByLabelText(/^Coffee: /));
      expect(mockRouter.push).toHaveBeenCalledWith({
        pathname: '/budget-edit',
        params: { categoryId: 'food.coffee' },
      });
    });

    it('updates as soon as a budget is set', async () => {
      const source = makeSource({ ...seed, budgets: [] });
      await renderWithData(<HomeScreen />, source);
      expect(await screen.findByText("See what's safe to spend")).toBeOnTheScreen();

      await act(() => source.setBudget({ categoryId: 'food.dining', amountMinor: 20_000 }));
      expect(await screen.findByText('$140')).toBeOnTheScreen();
      expect(screen.getByText('Based on your category budgets')).toBeOnTheScreen();
    });
  });

  it('reads the clock again after a write', async () => {
    let clock = FIXED_NOW;
    const source = createSyntheticDataSource({ now: () => clock });
    await renderWithData(<HomeScreen />, source);
    expect(await screen.findByText('Good morning')).toBeOnTheScreen();

    clock = new Date(2026, 9, 16, 19, 0);
    await act(() => source.updateSettings({}));
    expect(await screen.findByText('Good evening')).toBeOnTheScreen();
    expect(screen.getByText('Friday, October 16')).toBeOnTheScreen();
  });
});
