import { fireEvent, screen } from '@testing-library/react-native';

import { emptySeed, FIXED_NOW, makeSource, renderWithData } from '@/testing/render';
import { mockRouter, resetRouter } from '@/testing/router';

import { AddTransactionScreen, occurredAtFor } from '../AddTransactionScreen';

jest.mock('expo-router', () => require('@/testing/router').routerModule);

const MONTH = {
  from: new Date(2026, 9, 1).toISOString(),
  to: new Date(2026, 10, 1).toISOString(),
};

describe('AddTransactionScreen', () => {
  beforeEach(resetRouter);

  it('saves an expense typed cents-first with a picked category and note', async () => {
    const source = makeSource(emptySeed);
    await renderWithData(<AddTransactionScreen />, source);

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    await fireEvent.changeText(screen.getByTestId('add-amount'), '4520');
    expect(screen.getByTestId('add-amount')).toHaveDisplayValue('45.20');
    await fireEvent.changeText(screen.getByTestId('add-merchant'), '  Corner Cafe ');
    expect(save).toBeDisabled();

    await fireEvent.press(screen.getByRole('button', { name: 'Pick a category' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Coffee' }));
    expect(screen.getByRole('button', { name: 'Category: Coffee' })).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Note'), 'Team treat');

    await fireEvent.press(save);
    expect(mockRouter.back).toHaveBeenCalled();
    const [tx] = await source.listTransactions(MONTH);
    expect(tx).toMatchObject({
      amountMinor: 4_520,
      merchantName: 'Corner Cafe',
      categoryId: 'food.coffee',
      kind: 'expense',
      source: 'manual',
      status: 'confirmed',
      note: 'Team treat',
      occurredAt: FIXED_NOW.toISOString(),
    });
  });

  it('logs income without a category, on an earlier day', async () => {
    const source = makeSource(emptySeed);
    await renderWithData(<AddTransactionScreen />, source);

    await fireEvent.press(screen.getByRole('radio', { name: 'Income' }));
    expect(screen.queryByRole('button', { name: 'Pick a category' })).toBeNull();
    await fireEvent.changeText(screen.getByTestId('add-amount'), '150000');
    await fireEvent.changeText(screen.getByLabelText('From'), 'Paycheck');

    expect(screen.getByTestId('add-date')).toHaveTextContent('Today, Oct 15');
    await fireEvent.press(screen.getByRole('button', { name: 'Day before' }));
    expect(screen.getByTestId('add-date')).toHaveTextContent('Yesterday, Oct 14');

    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    const [tx] = await source.listTransactions(MONTH);
    expect(tx).toMatchObject({ amountMinor: 150_000, kind: 'income' });
    expect(new Date(tx!.occurredAt).getDate()).toBe(14);
  });

  it('closes to Home when there is nothing to go back to', async () => {
    mockRouter.canGoBack.mockReturnValueOnce(false);
    await renderWithData(<AddTransactionScreen />, makeSource(emptySeed));
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });

  it('keeps the time of day when stepping back', () => {
    expect(occurredAtFor(3, FIXED_NOW)).toEqual(new Date(2026, 9, 12, 9, 30));
  });
});
