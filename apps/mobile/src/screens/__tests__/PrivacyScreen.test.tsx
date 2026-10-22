import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { CLOUD_NEVER_SENT, CLOUD_SENT_SUMMARY } from '@/content/privacy';
import type { DataSource } from '@/data';
import { defaultSeed } from '@/data/syntheticSeed';
import { makeSource, renderWithData } from '@/testing/render';
import { mockRouter, resetRouter } from '@/testing/router';

import { PrivacyScreen } from '../PrivacyScreen';
import { SettingsScreen } from '../SettingsScreen';

jest.mock('expo-router', () => require('@/testing/router').routerModule);

const onboarded = { ...defaultSeed, onboarding: { completed: true, step: 'waiting' as const } };

async function setup(source: DataSource = makeSource(onboarded), os = 'android') {
  await renderWithData(<PrivacyScreen os={os} />, source);
  await screen.findByLabelText(`Transactions: ${defaultSeed.transactions.length}`);
  return source;
}

async function startDelete() {
  await fireEvent.press(screen.getByRole('button', { name: 'Delete all my data' }));
  return screen.getByLabelText('Type DELETE to confirm');
}

describe('PrivacyScreen', () => {
  beforeEach(resetRouter);

  it('shows counts of what is on this phone', async () => {
    await setup();
    expect(screen.getByLabelText(`Budgets: ${defaultSeed.budgets.length}`)).toBeOnTheScreen();
    expect(
      screen.getByLabelText(`Subscriptions: ${defaultSeed.subscriptions.length}`),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Merchant rules you taught it: 0')).toBeOnTheScreen();
    expect(screen.getByLabelText('Processed on this device')).toBeOnTheScreen();
    expect(screen.getByText(/Reading alerts makes no network calls/)).toBeOnTheScreen();
  });

  it('says when data is encrypted on the device', async () => {
    const source = makeSource(onboarded);
    const summary = source.getPrivacySummary!;
    source.getPrivacySummary = async () => ({ ...(await summary()), encryptedAtRest: true });
    await setup(source);
    expect(screen.getByText(/Stored in an encrypted database/)).toBeOnTheScreen();
  });

  it('shows the same cloud AI disclosure as Settings', async () => {
    await setup();
    expect(screen.getByText('Off')).toBeOnTheScreen();
    expect(screen.getByText(CLOUD_SENT_SUMMARY)).toBeOnTheScreen();
    expect(screen.getByText(CLOUD_NEVER_SENT)).toBeOnTheScreen();
  });

  it('shows cloud AI as on when the user opted in', async () => {
    await setup(makeSource({ ...onboarded, settings: { cloudAiOptIn: true } }));
    expect(screen.getByText('On')).toBeOnTheScreen();
    expect(screen.getByText(/You turned it on/)).toBeOnTheScreen();
  });

  it('lists the apps it reads on Android by name', async () => {
    await setup();
    expect(screen.getByLabelText('Chase, including Zelle alerts')).toBeOnTheScreen();
    expect(screen.getByLabelText('Venmo')).toBeOnTheScreen();
    expect(screen.getByText(/Google Messages/)).toBeOnTheScreen();
    expect(screen.queryByText(/com\.chase/)).toBeNull();
  });

  it('explains what it can read on iPhone instead', async () => {
    await setup(makeSource(onboarded), 'ios');
    expect(screen.getByText(/can’t see other apps’ notifications/)).toBeOnTheScreen();
    expect(screen.queryByLabelText('Venmo')).toBeNull();
  });

  it('deletes everything only after DELETE is typed, then starts over at onboarding', async () => {
    const source = await setup();
    const input = await startDelete();
    const confirm = () => screen.getByRole('button', { name: 'Delete everything' });

    expect(confirm()).toBeDisabled();
    await fireEvent.changeText(input, 'delet');
    expect(confirm()).toBeDisabled();
    await fireEvent.changeText(input, 'delete');
    expect(confirm()).toBeEnabled();

    await fireEvent.press(confirm());
    await waitFor(async () =>
      expect(await source.getOnboarding()).toEqual({ completed: false, step: 'welcome' }),
    );
    expect(await source.getPrivacySummary!()).toMatchObject({
      transactions: 0,
      budgets: 0,
      subscriptions: 0,
      rules: 0,
    });
    expect(await screen.findByLabelText('Transactions: 0')).toBeOnTheScreen();
  });

  it('cancel leaves everything in place', async () => {
    const source = makeSource(onboarded);
    const deleteAll = jest.fn(async () => {});
    source.deleteAllData = deleteAll;
    await setup(source);
    await fireEvent.changeText(await startDelete(), 'DELETE');
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));

    expect(deleteAll).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete all my data' })).toBeOnTheScreen();
    expect(screen.queryByLabelText('Type DELETE to confirm')).toBeNull();
  });

  it('says so when deleting fails, and lets the user try again', async () => {
    const source = makeSource(onboarded);
    const deleteAll = jest.fn(async () => {
      throw new Error('Could not delete all data');
    });
    source.deleteAllData = deleteAll;
    await setup(source);
    await fireEvent.changeText(await startDelete(), 'DELETE');
    await fireEvent.press(screen.getByRole('button', { name: 'Delete everything' }));

    expect(await screen.findByText(/Not everything could be deleted/)).toBeOnTheScreen();
    expect(deleteAll).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Delete everything' })).toBeEnabled();
  });

  it('hides delete when the data source has nothing to delete', async () => {
    const source = makeSource(onboarded);
    delete source.deleteAllData;
    await setup(source);
    expect(screen.queryByRole('button', { name: 'Delete all my data' })).toBeNull();
  });

  it('opens from Settings', async () => {
    await renderWithData(<SettingsScreen />, makeSource(onboarded));
    await fireEvent.press(await screen.findByRole('button', { name: 'Privacy & data' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/privacy');
  });
});
