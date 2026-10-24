import { fireEvent, screen } from '@testing-library/react-native';

import type { SyntheticSeed } from '@/data/syntheticSeed';
import { emptySeed, makeSource, renderWithData } from '@/testing/render';
import { mockRouter, resetRouter } from '@/testing/router';

import { BudgetEditScreen } from '../BudgetEditScreen';
import { BudgetsScreen } from '../BudgetsScreen';

jest.mock('expo-router', () => require('@/testing/router').routerModule);

/**
 * October 15, 9:30 AM: 17 days left including today. Spending this month: groceries $212.40 +
 * dining $50.00 = $262.40. The transfer, the income and last month's charge do not count.
 */
const seed: SyntheticSeed = {
  ...emptySeed,
  transactions: [
    {
      daysAgo: 1,
      at: [18, 0],
      merchant: "Trader Joe's",
      amountMinor: 21_240,
      category: 'food.groceries',
    },
    { daysAgo: 2, at: [19, 0], merchant: 'Chipotle', amountMinor: 5_000, category: 'food.dining' },
    {
      daysAgo: 3,
      at: [9, 0],
      merchant: 'Savings',
      amountMinor: 10_000,
      category: 'other.general',
      kind: 'transfer',
    },
    {
      daysAgo: 4,
      at: [9, 0],
      merchant: 'Payroll',
      amountMinor: 200_000,
      category: 'other.general',
      kind: 'income',
    },
    { daysAgo: 30, at: [9, 0], merchant: 'Old', amountMinor: 99_999, category: 'food.groceries' },
  ],
  budgets: [
    { category: null, amountMinor: 100_000 },
    { category: 'food.groceries', amountMinor: 30_000 },
    { category: 'food.dining', amountMinor: 4_000 },
  ],
};

describe('BudgetsScreen', () => {
  beforeEach(resetRouter);

  it('shows safe to spend and pace for the overall budget', async () => {
    await renderWithData(<BudgetsScreen />, makeSource(seed));

    expect(await screen.findByText('$737.60')).toBeOnTheScreen();
    expect(screen.getByLabelText('Safe to spend: 737 dollars and 60 cents')).toBeOnTheScreen();
    expect(
      screen.getByText('$262.40 of $1,000 spent · about $43.38 a day until Oct 31'),
    ).toBeOnTheScreen();
    expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ now: 26 });
    expect(screen.getByText('On track')).toBeOnTheScreen();
    expect(screen.getByText('October')).toBeOnTheScreen();
  });

  it('shows per-category spent, budget, and what is left or over', async () => {
    await renderWithData(<BudgetsScreen />, makeSource(seed));

    expect(await screen.findByText('$212.40 of $300')).toBeOnTheScreen();
    expect(screen.getByText('$87.60 left')).toBeOnTheScreen();
    expect(screen.getByText('$50 of $40')).toBeOnTheScreen();
    expect(screen.getByText('Over by $10')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', {
        name: 'Groceries: spent 212 dollars and 40 cents of 300 dollars, 87 dollars and 60 cents left',
      }),
    ).toBeOnTheScreen();
  });

  it('opens the editor for a category, the overall budget, or a new budget', async () => {
    await renderWithData(<BudgetsScreen />, makeSource(seed));

    await fireEvent.press(await screen.findByRole('button', { name: /^Dining Out:/ }));
    expect(mockRouter.push).toHaveBeenLastCalledWith({
      pathname: '/budget-edit',
      params: { categoryId: 'food.dining' },
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Edit monthly budget' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith({
      pathname: '/budget-edit',
      params: { categoryId: 'overall' },
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Set a budget' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/budget-edit', params: {} });
    await fireEvent.press(screen.getByRole('button', { name: /^Spending trends/ }));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/trends');
  });

  it('prompts for a monthly budget when there is none', async () => {
    await renderWithData(<BudgetsScreen />, makeSource(emptySeed));
    expect(await screen.findByText('Set a monthly budget')).toBeOnTheScreen();
    expect(screen.getByText('No category budgets yet')).toBeOnTheScreen();
    // One primary action: the monthly budget. The category prompt stays secondary.
    expect(screen.getByRole('button', { name: 'Set monthly budget' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Add a category budget' })).toBeOnTheScreen();
  });
});

describe('BudgetEditScreen', () => {
  beforeEach(resetRouter);

  it('formats the amount as you type and saves a new category budget', async () => {
    const source = makeSource(seed);
    await renderWithData(<BudgetEditScreen />, source);

    const save = await screen.findByRole('button', { name: 'Save budget' });
    expect(save).toBeDisabled();

    await fireEvent.changeText(screen.getByTestId('budget-amount'), '1250.509');
    expect(screen.getByTestId('budget-amount').props.value).toBe('1,250.50');
    // No category yet: still disabled.
    expect(screen.getByRole('button', { name: 'Save budget' })).toBeDisabled();

    await fireEvent.press(screen.getByRole('radio', { name: 'Coffee' }));
    await fireEvent.changeText(screen.getByTestId('budget-amount'), '45');
    await fireEvent.press(screen.getByRole('button', { name: 'Save budget' }));

    expect(mockRouter.back).toHaveBeenCalled();
    const rows = await source.listBudgets({
      from: '2000-01-01T00:00:00Z',
      to: '2100-01-01T00:00:00Z',
    });
    expect(rows.find((r) => r.budget.categoryId === 'food.coffee')?.budget.amountMinor).toBe(4_500);
  });

  it('prefills and updates an existing budget', async () => {
    const source = makeSource(seed);
    await renderWithData(<BudgetEditScreen initialCategoryId="food.groceries" />, source);

    expect(await screen.findByText('Edit budget')).toBeOnTheScreen();
    expect(screen.getByTestId('budget-amount').props.value).toBe('300');
    expect(screen.getByText('Spent so far this month: $212.40')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId('budget-amount'), '350');
    await fireEvent.press(screen.getByRole('button', { name: 'Save budget' }));

    const rows = await source.listBudgets({
      from: '2000-01-01T00:00:00Z',
      to: '2100-01-01T00:00:00Z',
    });
    const groceries = rows.filter((r) => r.budget.categoryId === 'food.groceries');
    expect(groceries).toHaveLength(1);
    expect(groceries[0]?.budget.amountMinor).toBe(35_000);
  });

  it('removes a budget', async () => {
    const source = makeSource(seed);
    await renderWithData(<BudgetEditScreen initialCategoryId="food.dining" />, source);
    await fireEvent.press(await screen.findByRole('button', { name: 'Remove budget' }));
    // Asks first; nothing is removed until confirmed.
    expect(screen.getByText('Remove this budget?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Remove' }));
    expect(mockRouter.back).toHaveBeenCalled();
    const rows = await source.listBudgets({
      from: '2000-01-01T00:00:00Z',
      to: '2100-01-01T00:00:00Z',
    });
    expect(rows.some((r) => r.budget.categoryId === 'food.dining')).toBe(false);
  });
});
