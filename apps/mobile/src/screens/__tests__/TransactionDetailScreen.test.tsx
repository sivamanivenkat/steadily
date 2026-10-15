import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { emptySeed, makeSource, renderWithData } from '@/testing/render';
import { resetRouter } from '@/testing/router';

import { TransactionDetailScreen } from '../TransactionDetailScreen';

jest.mock('expo-router', () => require('@/testing/router').routerModule);

const seed = {
  ...emptySeed,
  transactions: [
    {
      daysAgo: 0,
      at: [8, 42] as const,
      merchant: 'Blue Bottle Coffee',
      raw: 'SQ *BLUE BOTTLE COFFEE',
      amountMinor: 575,
      category: 'food.coffee' as const,
      issuer: 'chase',
      last4: '4821',
    },
  ],
};

async function setup() {
  const source = makeSource(seed);
  const [tx] = await source.listTransactions({
    from: '2000-01-01T00:00:00Z',
    to: '2100-01-01T00:00:00Z',
  });
  await renderWithData(<TransactionDetailScreen id={tx!.id} />, source);
  await screen.findByText('What we kept');
  return { source, id: tx!.id };
}

describe('TransactionDetailScreen', () => {
  beforeEach(resetRouter);

  it('lists only the stored fields under "What we kept"', async () => {
    await setup();
    expect(screen.getByLabelText('Merchant as written: SQ *BLUE BOTTLE COFFEE')).toBeOnTheScreen();
    expect(screen.getByLabelText('Card: Ending 4821')).toBeOnTheScreen();
    expect(screen.getByLabelText('Bank or app: Chase')).toBeOnTheScreen();
    expect(screen.getByLabelText('Captured from: Bank app notification')).toBeOnTheScreen();
    expect(screen.getByLabelText('Amount: $5.75 USD')).toBeOnTheScreen();
    expect(screen.getByLabelText('Processed on this device')).toBeOnTheScreen();
  });

  it('changes the category with a chip', async () => {
    const { source, id } = await setup();
    expect(screen.getByRole('button', { name: 'Coffee' })).toBeSelected();

    await fireEvent.press(screen.getByRole('button', { name: 'Dining Out' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dining Out' })).toBeSelected());
    expect((await source.getTransaction(id))?.categoryId).toBe('food.dining');
  });

  it('saves a note', async () => {
    const { source, id } = await setup();
    const save = screen.getByRole('button', { name: 'Save note' });
    expect(save).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText('Note'), 'Team coffee');
    await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));

    expect(await screen.findByLabelText('Note: Team coffee')).toBeOnTheScreen();
    expect((await source.getTransaction(id))?.note).toBe('Team coffee');
  });

  it('marks it as not an expense', async () => {
    const { source, id } = await setup();
    await fireEvent.press(screen.getByRole('button', { name: 'Not an expense' }));
    expect(await screen.findByLabelText('Type: Not an expense')).toBeOnTheScreen();
    expect((await source.getTransaction(id))?.kind).toBe('transfer');
  });
});
