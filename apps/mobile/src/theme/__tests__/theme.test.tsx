import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { darkColors, lightColors, resolveScheme, ThemePreferenceContext, useTheme } from '..';

function Probe() {
  const { colors } = useTheme();
  return <Text testID="ground">{colors.ground}</Text>;
}

describe('theme override', () => {
  it('resolves the user preference over the system setting', () => {
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', null)).toBe('light');
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
  });

  it('applies the override through context', async () => {
    await render(
      <ThemePreferenceContext.Provider value="dark">
        <Probe />
      </ThemePreferenceContext.Provider>,
    );
    expect(screen.getByTestId('ground')).toHaveTextContent(darkColors.ground);
  });

  it('follows the system without a provider', async () => {
    await render(<Probe />);
    expect(screen.getByTestId('ground')).toHaveTextContent(lightColors.ground);
  });
});
