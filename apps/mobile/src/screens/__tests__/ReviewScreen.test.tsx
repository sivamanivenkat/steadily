import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { emptySeed, makeSource, renderWithData } from '@/testing/render';
import { mockRouter, resetRouter } from '@/testing/router';

import { ReviewScreen } from '../ReviewScreen';

jest.mock('expo-router', () => require('@/testing/router').routerModule);

/** Two ordinary merchants in the queue: Corner Cafe (older) then Amazon. */
const twoCardSeed = {
  ...emptySeed,
  transactions: [
    {
      daysAgo: 1,
      at: [8, 0] as const,
      merchant: 'Corner Cafe',
      amountMinor: 1240,
      category: 'food.coffee' as const,
      review: ['food.coffee', 'food.dining', 'food.groceries'] as const,
      issuer: 'amex',
      last4: '1007',
    },
    {
      daysAgo: 0,
      at: [7, 0] as const,
      merchant: 'Amazon',
      amountMinor: 3299,
      category: 'shopping.general' as const,
      review: ['shopping.general', 'gifts.general', 'other.general'] as const,
      issuer: 'citi',
      last4: '2210',
    },
  ],
};

describe('ReviewScreen', () => {
  beforeEach(resetRouter);

  it('shows the oldest item as a review card with top-3 chips and card meta', async () => {
    await renderWithData(<ReviewScreen />, makeSource(twoCardSeed));

    expect(await screen.findByText('Corner Cafe')).toBeOnTheScreen();
    expect(screen.getByText('2 left')).toBeOnTheScreen();
    expect(screen.getByText('Not sure. Pick a category')).toBeOnTheScreen();
    expect(screen.getByText('$12.40')).toBeOnTheScreen();
    expect(screen.getByLabelText('12 dollars and 40 cents')).toBeOnTheScreen();
    expect(screen.getByText('Oct 14 · 8:00 AM · Card ending 1007')).toBeOnTheScreen();
    for (const name of ['Coffee', 'Dining Out', 'Groceries', 'More categories']) {
      expect(screen.getByRole('button', { name })).toBeOnTheScreen();
    }
    expect(screen.getByText('Your choice teaches Steadily on this phone')).toBeOnTheScreen();

    // Splitting is not built yet, so the card does not offer it.
    expect(screen.queryByRole('button', { name: 'Split across categories' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Not an expense' })).toBeOnTheScreen();
  });

  it('confirms a chip choice and moves to the next card', async () => {
    const source = makeSource(twoCardSeed);
    await renderWithData(<ReviewScreen />, source);

    await fireEvent.press(await screen.findByRole('button', { name: 'Dining Out' }));

    expect(await screen.findByText('Amazon')).toBeOnTheScreen();
    expect(screen.queryByText('Corner Cafe')).toBeNull();
    expect(screen.getByText('1 left')).toBeOnTheScreen();

    const queue = await source.listNeedsReview();
    expect(queue.map((i) => i.transaction.merchantName)).toEqual(['Amazon']);
    const all = await source.listTransactions({
      from: '2000-01-01T00:00:00Z',
      to: '2100-01-01T00:00:00Z',
    });
    const cafe = all.find((t) => t.merchantName === 'Corner Cafe');
    expect(cafe).toMatchObject({
      categoryId: 'food.dining',
      status: 'confirmed',
      categorySource: 'user',
    });
  });

  it('marks not an expense, then shows the empty state', async () => {
    const source = makeSource(twoCardSeed);
    await renderWithData(<ReviewScreen />, source);

    await fireEvent.press(await screen.findByRole('button', { name: 'Not an expense' }));
    expect(await screen.findByText('Amazon')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Not an expense' }));

    expect(await screen.findByText('All caught up')).toBeOnTheScreen();
    expect(screen.queryByText('Your choice teaches Steadily on this phone')).toBeNull();
    const all = await source.listTransactions({
      from: '2000-01-01T00:00:00Z',
      to: '2100-01-01T00:00:00Z',
    });
    expect(all.every((t) => t.kind === 'transfer' && t.status === 'confirmed')).toBe(true);

    await fireEvent.press(screen.getByRole('button', { name: 'Back to Home' }));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('shows "All caught up" when nothing needs review', async () => {
    await renderWithData(<ReviewScreen />, makeSource(emptySeed));
    expect(await screen.findByText('All caught up')).toBeOnTheScreen();
    expect(
      screen.getByText('New transactions that need a look will show up here.'),
    ).toBeOnTheScreen();
  });

  it('picks any of the 15 categories from the More sheet', async () => {
    const source = makeSource(twoCardSeed);
    await renderWithData(<ReviewScreen />, source);

    await fireEvent.press(await screen.findByRole('button', { name: 'More categories' }));
    expect(await screen.findByText('Pick a category')).toBeOnTheScreen();
    expect(screen.getAllByRole('radio')).toHaveLength(15);
    await fireEvent.press(screen.getByRole('radio', { name: 'Travel' }));

    expect(await screen.findByText('Amazon')).toBeOnTheScreen();
    const tx = (
      await source.listTransactions({ from: '2000-01-01T00:00:00Z', to: '2100-01-01T00:00:00Z' })
    ).find((t) => t.merchantName === 'Corner Cafe');
    expect(tx?.categoryId).toBe('travel.general');
  });

  it('asks what a payment to a person was for', async () => {
    const source = makeSource({
      ...emptySeed,
      transactions: [
        {
          daysAgo: 1,
          at: [12, 30],
          merchant: 'Alex M.',
          amountMinor: 4500,
          category: 'other.general',
          review: ['food.dining', 'entertainment.general', 'transport.general'],
          issuer: 'venmo',
        },
        {
          daysAgo: 0,
          at: [9, 0],
          merchant: 'Jordan P.',
          amountMinor: 2000,
          category: 'other.general',
          review: ['food.dining', 'gifts.general', 'entertainment.general'],
          issuer: 'cash_app',
        },
      ],
    });
    await renderWithData(<ReviewScreen />, source);

    expect(await screen.findByText('What was this for?')).toBeOnTheScreen();
    expect(screen.getByText('Payment to a person')).toBeOnTheScreen();
    expect(screen.getByText('Oct 14 · 12:30 PM · Venmo')).toBeOnTheScreen();
    for (const name of ['Split a bill', 'Paying back', 'Rent', 'Gift']) {
      expect(screen.getByRole('button', { name })).toBeOnTheScreen();
    }

    // Split a bill asks for the category next.
    await fireEvent.press(screen.getByRole('button', { name: 'Split a bill' }));
    expect(await screen.findByText('What was it for?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Dining Out' }));

    // Gift files straight to Gifts & Giving.
    expect(await screen.findByText('Jordan P.')).toBeOnTheScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Gift' }));
    expect(await screen.findByText('All caught up')).toBeOnTheScreen();

    const all = await source.listTransactions({
      from: '2000-01-01T00:00:00Z',
      to: '2100-01-01T00:00:00Z',
    });
    expect(Object.fromEntries(all.map((t) => [t.merchantName, t.categoryId]))).toEqual({
      'Alex M.': 'food.dining',
      'Jordan P.': 'gifts.general',
    });
  });

  it('applies "Always use for" to other queued charges from the same merchant', async () => {
    const source = makeSource({
      ...emptySeed,
      transactions: [
        {
          daysAgo: 2,
          at: [8, 0],
          merchant: 'Corner Cafe',
          amountMinor: 500,
          category: 'food.coffee',
          review: ['food.coffee'],
        },
        {
          daysAgo: 1,
          at: [8, 0],
          merchant: 'Corner Cafe',
          amountMinor: 700,
          category: 'food.coffee',
          review: ['food.coffee'],
        },
      ],
    });
    await renderWithData(<ReviewScreen />, source);

    expect(await screen.findByRole('switch', { name: 'Always use for Corner Cafe' })).toBeChecked();
    await fireEvent.press(screen.getByRole('button', { name: 'Coffee' }));

    expect(await screen.findByText('All caught up')).toBeOnTheScreen();
    await waitFor(async () => expect(await source.listNeedsReview()).toHaveLength(0));
  });
});
