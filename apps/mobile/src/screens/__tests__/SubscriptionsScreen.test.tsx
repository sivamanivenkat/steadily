import { fireEvent, screen } from '@testing-library/react-native';

import { emptySeed, makeSource, renderWithData } from '@/testing/render';
import { mockRouter, resetRouter } from '@/testing/router';

import { HomeScreen } from '../HomeScreen';
import { SettingsScreen } from '../SettingsScreen';
import { SubscriptionsScreen } from '../SubscriptionsScreen';

jest.mock('expo-router', () => require('@/testing/router').routerModule);

/**
 * Default synthetic seed on October 15: Netflix $17.99 monthly (was $15.49), last charged Oct 13;
 * Spotify $11.99 monthly, last charged Oct 6.
 */
const NETFLIX =
  'Netflix, 17 dollars and 99 cents a month, next charge Nov 13, price up 2 dollars and 50 cents';
const SPOTIFY = 'Spotify, 11 dollars and 99 cents a month, next charge Nov 6';

describe('SubscriptionsScreen', () => {
  beforeEach(resetRouter);

  it('lists subscriptions soonest first with the monthly total and price changes', async () => {
    await renderWithData(<SubscriptionsScreen />);

    expect(await screen.findByText('$29.98')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('About 29 dollars and 98 cents a month for 2 subscriptions'),
    ).toBeOnTheScreen();
    expect(screen.getByText('On-device')).toBeOnTheScreen();

    const rows = screen.getAllByRole('button', { name: /a month, next charge/ });
    expect(rows.map((r) => r.props.accessibilityLabel)).toEqual([SPOTIFY, NETFLIX]);
    expect(screen.getByText('Price up $2.50')).toBeOnTheScreen();
    expect(screen.getAllByText('Monthly · next Nov 13')).toHaveLength(1);
  });

  it('shows recent charges in the detail sheet', async () => {
    await renderWithData(<SubscriptionsScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: NETFLIX }));

    expect(await screen.findByLabelText('Oct 13: 17 dollars and 99 cents')).toBeOnTheScreen();
    expect(screen.getByLabelText('Sep 13: 15 dollars and 49 cents')).toBeOnTheScreen();
    expect(screen.getByText('Recent charges')).toBeOnTheScreen();
    expect(screen.getByText('Was $15.49, now $17.99')).toBeOnTheScreen();
    expect(screen.getByLabelText('17 dollars and 99 cents a month')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Recent charges')).toBeNull();
  });

  it('marks one as not a subscription, with undo', async () => {
    const source = makeSource();
    await renderWithData(<SubscriptionsScreen />, source);
    await fireEvent.press(await screen.findByRole('button', { name: NETFLIX }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Not a subscription' }));

    expect(
      await screen.findByText('Netflix is no longer counted as a subscription.'),
    ).toBeOnTheScreen();
    expect(await screen.findByText('$11.99')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: NETFLIX })).toBeNull();
    expect((await source.listSubscriptions()).map((s) => s.subscription.merchantName)).toEqual([
      'Spotify',
    ]);

    await fireEvent.press(
      screen.getByRole('button', { name: 'Undo, count Netflix as a subscription again' }),
    );
    expect(await screen.findByText('$29.98')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: NETFLIX })).toBeOnTheScreen();
    expect(screen.queryByText('Netflix is no longer counted as a subscription.')).toBeNull();
  });

  it('explains when nothing has been found yet', async () => {
    await renderWithData(<SubscriptionsScreen />, makeSource(emptySeed));
    expect(await screen.findByText('No subscriptions found yet')).toBeOnTheScreen();
  });

  it('shows a loading state', async () => {
    const source = makeSource();
    await renderWithData(<SubscriptionsScreen />, {
      ...source,
      listSubscriptions: () => new Promise(() => {}),
    });
    expect(await screen.findByText('Looking for repeating charges…')).toBeOnTheScreen();
  });
});

describe('Subscriptions entry points', () => {
  beforeEach(resetRouter);

  it('opens from the upcoming charges on Home', async () => {
    await renderWithData(<HomeScreen />);
    expect(
      await screen.findByLabelText('Spotify, 11 dollars and 99 cents, due Nov 6'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'See all subscriptions' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/subscriptions');
    mockRouter.push.mockClear();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Netflix, 17 dollars and 99 cents, due Nov 13' }),
    );
    // An upcoming row opens that subscription.
    expect(mockRouter.push).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/subscriptions', params: { id: expect.any(String) } }),
    );
  });

  it('opens from Settings', async () => {
    await renderWithData(<SettingsScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Subscriptions' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/subscriptions');
    await fireEvent.press(screen.getByRole('button', { name: 'Spending trends' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/trends');
  });
});
