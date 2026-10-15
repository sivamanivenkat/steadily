import { fireEvent, render, screen } from '@testing-library/react-native';

import { HomeScreen } from '../HomeScreen';

const mockPush = jest.fn();
const mockNavigate = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, navigate: mockNavigate, back: jest.fn() }),
}));

describe('HomeScreen', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockNavigate.mockClear();
  });

  it('renders the synthetic home data', async () => {
    await render(<HomeScreen />);

    expect(screen.getByText('Good morning')).toBeOnTheScreen();
    expect(screen.getByText('Thursday, October 15')).toBeOnTheScreen();
    expect(screen.getByText('$1,284')).toBeOnTheScreen();
    expect(screen.getByText('52% spent')).toBeOnTheScreen();
    expect(screen.getByText('48% of month')).toBeOnTheScreen();
    expect(screen.getByText('A little ahead')).toBeOnTheScreen();
    expect(screen.getByText('3 to review')).toBeOnTheScreen();

    expect(screen.getByText('Blue Bottle Coffee')).toBeOnTheScreen();
    expect(screen.getByText('$5.75')).toBeOnTheScreen();
    expect(screen.getByText("Trader Joe's")).toBeOnTheScreen();
    expect(screen.getByText('$64.20')).toBeOnTheScreen();
    expect(screen.getByText('Uber')).toBeOnTheScreen();
    expect(screen.getByText('$18.40')).toBeOnTheScreen();
    expect(screen.getByText('Netflix')).toBeOnTheScreen();
    expect(screen.getByText('$17.99')).toBeOnTheScreen();
    expect(screen.getByText('Price up $2.50')).toBeOnTheScreen();
  });

  it('labels icon-only controls and reads amounts as currency', async () => {
    await render(<HomeScreen />);

    fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
    expect(mockPush).toHaveBeenCalledWith('/settings');

    expect(screen.getByLabelText('Safe to spend: 1,284 dollars')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Blue Bottle Coffee, 5 dollars and 75 cents, Coffee, 8:42 AM'),
    ).toBeOnTheScreen();
    expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ now: 52 });
  });

  it('opens Activity from the review row', async () => {
    await render(<HomeScreen />);
    fireEvent.press(screen.getByRole('button', { name: '3 transactions to review' }));
    expect(mockNavigate).toHaveBeenCalledWith('/activity');
  });
});
