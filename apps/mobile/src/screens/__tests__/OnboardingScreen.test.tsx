import { fireEvent, screen } from '@testing-library/react-native';

import { makeSource, renderWithData } from '@/testing/render';
import { resetRouter } from '@/testing/router';

import { OnboardingScreen } from '../OnboardingScreen';

jest.mock('expo-router', () => require('@/testing/router').routerModule);

async function pickChaseAndVenmo() {
  await fireEvent.press(await screen.findByRole('button', { name: 'Get started' }));
  await fireEvent.press(await screen.findByRole('checkbox', { name: 'Chase' }));
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Venmo' }));
  expect(screen.getByRole('checkbox', { name: 'Chase' })).toBeChecked();
  await fireEvent.press(screen.getByRole('button', { name: 'Continue with 2' }));
}

describe('OnboardingScreen', () => {
  beforeEach(resetRouter);

  it('opens with the privacy promise and a progress indicator', async () => {
    await renderWithData(<OnboardingScreen platform="ios" />);
    expect(
      await screen.findByText('No bank login. Alerts are read on your phone.'),
    ).toBeOnTheScreen();
    expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ now: 1, max: 5 });
    expect(screen.getByText('Step 1 of 5')).toBeOnTheScreen();
  });

  it('lists every issuer as a text tile', async () => {
    await renderWithData(<OnboardingScreen platform="ios" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Get started' }));
    expect(await screen.findAllByRole('checkbox')).toHaveLength(12);
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeOnTheScreen();
  });

  it('walks through issuer guides and resumes where the user left off', async () => {
    const source = makeSource();
    const first = await renderWithData(<OnboardingScreen platform="ios" />, source);

    await pickChaseAndVenmo();
    expect(await screen.findByText('Turn on Chase alerts')).toBeOnTheScreen();
    expect(screen.getByText('Card 1 of 2')).toBeOnTheScreen();
    expect(screen.getByText('General steps. Menu names in your app may differ.')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: "I've done it" }));
    expect(await screen.findByText('Turn on Venmo alerts')).toBeOnTheScreen();

    // Leave and come back: the same step and card.
    await first.unmount();
    await renderWithData(<OnboardingScreen platform="ios" />, source);
    expect(await screen.findByText('Turn on Venmo alerts')).toBeOnTheScreen();
    expect(screen.getByText('Step 3 of 5')).toBeOnTheScreen();
    expect(screen.getByText('Card 2 of 2')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Skip' }));
    expect(await screen.findByText('Cards are set')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Connect your text alerts')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: "I've set it up" }));

    expect(await screen.findByText('Waiting for your first alert')).toBeOnTheScreen();
    // The synthetic data already has Chase and Venmo alerts from this week.
    expect(screen.getByLabelText('Chase: Receiving alerts')).toBeOnTheScreen();
    expect(screen.getByLabelText('Venmo: Receiving alerts')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Go to Home' }));
    expect(await source.getOnboarding()).toEqual({ completed: true, step: 'waiting' });

    const setups = await source.listIssuerSetup();
    expect(setups.filter((s) => s.selected).map((s) => [s.issuerId, s.setupStatus])).toEqual([
      ['chase', 'done'],
      ['venmo', 'skipped'],
    ]);
  });

  it('adds the notification access and battery steps on Android', async () => {
    const source = makeSource();
    await source.saveOnboarding({ step: 'connect' });
    await renderWithData(<OnboardingScreen platform="android" />, source);

    expect(await screen.findByText('Let Steadily see bank notifications')).toBeOnTheScreen();
    expect(screen.getByText('Step 4 of 6')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Open notification access' })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Keep Steadily ready')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Let Steadily see bank notifications')).toBeOnTheScreen();
  });

  it('can be skipped at any step and keeps the saved step', async () => {
    const source = makeSource();
    await renderWithData(<OnboardingScreen platform="ios" />, source);
    await fireEvent.press(await screen.findByRole('button', { name: 'Get started' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Set up later' }));
    expect(await source.getOnboarding()).toEqual({ completed: true, step: 'issuers' });
  });

  it('skips the guides when no issuer is picked', async () => {
    const source = makeSource();
    await renderWithData(<OnboardingScreen platform="ios" />, source);
    await fireEvent.press(await screen.findByRole('button', { name: 'Get started' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByText('Connect your text alerts')).toBeOnTheScreen();
  });
});
