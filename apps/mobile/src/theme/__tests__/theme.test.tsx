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

/** WCAG contrast ratio of two opaque `#RRGGBB` colors. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const [r = 0, g = 0, bl = 0] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('destructive tokens', () => {
  it('meet 4.5:1 for the filled button and for text on solid surfaces', () => {
    for (const c of [lightColors, darkColors]) {
      expect(contrast(c.destructive.fill, c.destructive.onFill)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.destructive.text, c.solidSurface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.destructive.text, c.ground)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
