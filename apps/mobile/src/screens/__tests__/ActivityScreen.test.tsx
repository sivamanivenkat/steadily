import { fireEvent, screen } from '@testing-library/react-native';

import { renderWithData } from '@/testing/render';
import { mockRouter, resetRouter } from '@/testing/router';

import { ActivityScreen } from '../ActivityScreen';

jest.mock('expo-router', () => require('@/testing/router').routerModule);

describe('ActivityScreen', () => {
  beforeEach(resetRouter);

  it('groups transactions by day with day spending totals', async () => {
    await renderWithData(<ActivityScreen />);

    // Today: Blue Bottle $5.75 + Corner Cafe $12.40.
    expect(await screen.findByLabelText('Today, spent 18 dollars and 15 cents')).toBeOnTheScreen();
    expect(screen.getByText('$18.15')).toBeOnTheScreen();
    // Yesterday: Uber + Trader Joe's + Alex M.
    expect(screen.getByLabelText('Yesterday, spent 127 dollars and 60 cents')).toBeOnTheScreen();
    // Income does not count as spending, and shows with a plus sign.
    expect(screen.getByLabelText('Saturday, Oct 3, spent 0 dollars')).toBeOnTheScreen();
    expect(screen.getByText('+$2,450.00')).toBeOnTheScreen();
    // Last month is included.
    expect(screen.getByText('Delta Air Lines')).toBeOnTheScreen();
    expect(screen.getByText('4 to review')).toBeOnTheScreen();
  });

  it('searches by merchant name', async () => {
    await renderWithData(<ActivityScreen />);
    await screen.findAllByText('Chipotle');

    await fireEvent.changeText(screen.getByLabelText('Search merchants'), 'blue');

    expect(screen.getAllByText('Blue Bottle Coffee')).toHaveLength(2);
    expect(screen.queryByText('Chipotle')).toBeNull();
    expect(screen.queryByText('Uber')).toBeNull();

    await fireEvent.changeText(screen.getByLabelText('Search merchants'), 'zzz');
    expect(screen.getByText('No matches')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getAllByText('Chipotle').length).toBeGreaterThan(0);
  });

  it('filters by category chip and clears with All', async () => {
    await renderWithData(<ActivityScreen />);
    await screen.findAllByText('Chipotle');

    await fireEvent.press(screen.getByRole('button', { name: 'Gas' }));
    expect(screen.getByRole('button', { name: 'Gas' })).toBeSelected();
    expect(screen.getByText('Shell')).toBeOnTheScreen();
    expect(screen.queryByText('Chipotle')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'All categories' }));
    expect(screen.getAllByText('Chipotle').length).toBeGreaterThan(0);
  });

  it('only offers filters for categories that have transactions', async () => {
    await renderWithData(<ActivityScreen />);
    await screen.findAllByText('Chipotle');
    expect(screen.getByRole('button', { name: 'Travel' })).toBeOnTheScreen();
  });

  it('opens the transaction detail and the review queue', async () => {
    await renderWithData(<ActivityScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: /^Shell, / }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/transaction/[id]',
      params: { id: expect.any(String) },
    });

    await fireEvent.press(screen.getByRole('button', { name: '4 transactions to review' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/review');

    await fireEvent.press(screen.getByRole('button', { name: 'Add transaction' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/add');
  });
});
