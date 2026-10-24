import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { lightColors } from '@/theme';

import { Button } from '../Button';
import { ConfirmSheet } from '../ConfirmSheet';
import { ProgressBar } from '../ProgressBar';

/** Background color of the first view under the button that has one. */
function fillOf(name: string): unknown {
  const button = screen.getByRole('button', { name });
  const queue = [...button.children];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || typeof node === 'string') continue;
    const style = StyleSheet.flatten(node.props.style) as { backgroundColor?: string } | undefined;
    if (style?.backgroundColor) return style.backgroundColor;
    queue.push(...node.children);
  }
  return undefined;
}

describe('Button destructive', () => {
  it('fills with the destructive token and still presses', async () => {
    const onPress = jest.fn();
    await render(<Button label="Delete everything" variant="destructive" onPress={onPress} />);
    expect(fillOf('Delete everything')).toBe(lightColors.destructive.fill);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete everything' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('ConfirmSheet destructive', () => {
  it('uses the destructive button for the confirm action only when asked', async () => {
    const props = {
      visible: true,
      title: 'Remove budget?',
      body: ['This removes the budget.'],
      confirmLabel: 'Remove',
      cancelLabel: 'Keep it',
      onConfirm: () => {},
      onCancel: () => {},
    };
    const { rerender } = await render(<ConfirmSheet {...props} destructive />);
    expect(fillOf('Remove')).toBe(lightColors.destructive.fill);
    await rerender(<ConfirmSheet {...props} />);
    expect(fillOf('Remove')).toBe(lightColors.accent);
  });
});

describe('ProgressBar', () => {
  it('reports its value as a percentage, clamped', async () => {
    await render(<ProgressBar value={1.4} accessibilityLabel="Import progress" />);
    expect(screen.getByRole('progressbar', { name: 'Import progress' })).toHaveAccessibilityValue({
      now: 100,
      text: '100%',
    });
  });

  it('speaks a custom value text', async () => {
    await render(
      <ProgressBar value={0.25} accessibilityLabel="Import progress" valueText="5 of 20" />,
    );
    expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ now: 25, text: '5 of 20' });
  });
});
