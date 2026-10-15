import { fireEvent, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { defaultSeed } from '@/data/syntheticSeed';
import { darkColors, lightColors, useTheme } from '@/theme';
import { makeSource, renderWithData } from '@/testing/render';
import { mockRouter, resetRouter } from '@/testing/router';

import { SettingsScreen } from '../SettingsScreen';

jest.mock('expo-router', () => require('@/testing/router').routerModule);

/** Shows which ground color the theme resolved to. */
function ThemeProbe() {
  const { scheme, colors } = useTheme();
  return <Text testID="probe">{`${scheme} ${colors.ground}`}</Text>;
}

async function setup() {
  const source = makeSource({
    ...defaultSeed,
    transactions: [
      ...defaultSeed.transactions,
      {
        daysAgo: 10,
        at: [12, 0],
        merchant: 'Old Navy',
        amountMinor: 3_000,
        category: 'shopping.general',
        issuer: 'wells_fargo',
        last4: '5555',
      },
    ],
    issuers: {
      chase: { selected: true, setupStatus: 'done' },
      discover: { selected: true, setupStatus: 'done' },
      wells_fargo: { selected: true, setupStatus: 'done' },
      us_bank: { selected: true, setupStatus: 'skipped' },
    },
  });
  await renderWithData(
    <>
      <SettingsScreen />
      <ThemeProbe />
    </>,
    source,
  );
  await screen.findByText('Daily summary');
  return source;
}

describe('SettingsScreen', () => {
  beforeEach(resetRouter);

  it('shows issuer status from captured alerts and setup progress', async () => {
    await setup();
    expect(screen.getByLabelText('Chase: Receiving alerts')).toBeOnTheScreen();
    expect(screen.getByLabelText('Discover: Waiting for first alert')).toBeOnTheScreen();
    // The only Wells Fargo alert is 10 days old.
    expect(screen.getByLabelText('Wells Fargo: No alerts in 7 days')).toBeOnTheScreen();
    expect(screen.getByLabelText('US Bank: Not set up')).toBeOnTheScreen();
  });

  it('persists notification settings', async () => {
    const source = await setup();

    expect(screen.getByRole('radio', { name: 'Only when unsure' })).toBeChecked();
    await fireEvent.press(screen.getByRole('radio', { name: 'Every transaction' }));
    expect(
      await screen.findByRole('radio', { name: 'Every transaction', checked: true }),
    ).toBeOnTheScreen();

    expect(screen.getByRole('switch', { name: 'Daily summary' })).toBeChecked();
    await fireEvent.press(screen.getByRole('switch', { name: 'Daily summary' }));

    await fireEvent.press(screen.getByRole('switch', { name: 'Quiet hours' }));
    expect(await screen.findByText('Notifications can arrive at any time.')).toBeOnTheScreen();

    expect(await source.getSettings()).toMatchObject({
      notifyMode: 'every_transaction',
      dailySummary: false,
      quietHours: null,
    });
    await fireEvent.press(screen.getByRole('switch', { name: 'Quiet hours' }));
    expect(await screen.findByText('No notifications from 10:00 PM to 7:00 AM.')).toBeOnTheScreen();
  });

  it('keeps cloud AI off by default and explains what would be sent', async () => {
    const source = await setup();
    const toggle = screen.getByRole('switch', { name: 'Use cloud AI for unclear merchants' });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText(/^Off\. Everything is worked out on this phone\./)).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Never sent: alert text, screenshots, card numbers, account details or your name.',
      ),
    ).toBeOnTheScreen();

    await fireEvent.press(toggle);
    expect(await screen.findByText(/^On\./)).toBeOnTheScreen();
    expect((await source.getSettings()).cloudAiOptIn).toBe(true);
  });

  it('applies the theme override app-wide', async () => {
    const source = await setup();
    expect(screen.getByTestId('probe')).toHaveTextContent(`light ${lightColors.ground}`);

    await fireEvent.press(screen.getByRole('radio', { name: 'Dark' }));
    expect(await screen.findByText(`dark ${darkColors.ground}`)).toBeOnTheScreen();
    expect((await source.getSettings()).theme).toBe('dark');

    await fireEvent.press(screen.getByRole('radio', { name: 'Match phone' }));
    expect(await screen.findByText(`light ${lightColors.ground}`)).toBeOnTheScreen();
  });

  it('reopens onboarding', async () => {
    const source = await setup();
    await source.saveOnboarding({ completed: true, step: 'connect' });

    await fireEvent.press(screen.getByRole('button', { name: 'Reopen onboarding' }));
    expect(await source.getOnboarding()).toEqual({ completed: false, step: 'connect' });

    await source.saveOnboarding({ completed: true });
    await fireEvent.press(
      screen.getByRole('button', { name: 'Restart onboarding from the beginning' }),
    );
    expect(await source.getOnboarding()).toEqual({ completed: false, step: 'welcome' });

    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(mockRouter.back).toHaveBeenCalled();
  });
});
