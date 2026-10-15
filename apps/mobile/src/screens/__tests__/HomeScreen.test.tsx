import { act, fireEvent, screen } from '@testing-library/react-native';

import { makeSource, renderWithData } from '@/testing/render';
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
});
