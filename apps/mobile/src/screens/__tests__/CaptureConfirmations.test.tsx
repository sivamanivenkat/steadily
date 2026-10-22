import { fireEvent, screen } from '@testing-library/react-native';

import { makeSource, renderWithData } from '@/testing/render';
import { resetRouter } from '@/testing/router';

import { OnboardingScreen } from '../OnboardingScreen';
import { SettingsScreen } from '../SettingsScreen';

jest.mock('expo-router', () => require('@/testing/router').routerModule);

/** Stand-in for the Android capture module on an Android 13+ phone. */
const mockNative = {
  enabled: true,
  canPost: false,
  request: jest.fn(async () => {
    mockNative.canPost = true;
    return 'granted';
  }),
};

jest.mock('@/capture', () => ({
  ...jest.requireActual('@/capture'),
  isCaptureAvailable: () => true,
  getCaptureNotificationsEnabled: () => mockNative.enabled,
  setCaptureNotificationsEnabled: (enabled: boolean) => {
    mockNative.enabled = enabled;
  },
  canPostCaptureNotifications: () => mockNative.canPost,
  needsNotificationPermission: () => true,
  requestNotificationPermission: () => mockNative.request(),
}));

describe('capture confirmations', () => {
  beforeEach(() => {
    resetRouter();
    mockNative.enabled = true;
    mockNative.canPost = false;
    mockNative.request.mockClear();
  });

  it('onboarding explains the confirmation and asks for notifications', async () => {
    const source = makeSource();
    await source.saveOnboarding({ step: 'connect' });
    await renderWithData(<OnboardingScreen platform="android" />, source);

    expect(await screen.findByText('See each purchase land')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Allow notifications' }));
    expect(mockNative.request).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Notifications allowed')).toBeOnTheScreen();
  });

  it('Settings toggles the confirmation and offers to allow notifications', async () => {
    await renderWithData(<SettingsScreen />);

    const toggle = await screen.findByRole('switch', { name: 'Confirm each logged purchase' });
    expect(toggle).toBeChecked();
    expect(
      screen.getByText("Notifications are off for Steadily, so confirmations can't show."),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Allow notifications' }));
    expect(mockNative.request).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Notifications are off/)).toBeNull();

    await fireEvent.press(toggle);
    expect(mockNative.enabled).toBe(false);
    expect(screen.getByRole('switch', { name: 'Confirm each logged purchase' })).not.toBeChecked();
  });
});
