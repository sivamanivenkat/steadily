import { useColorScheme } from 'react-native';

import { colors, type ColorScheme, type ColorTokens } from './colors';
import { glass, glassShadow, type GlassTokens, type GlassVariant } from './glass';

export * from './colors';
export * from './glass';
export * from './type';
export * from './spacing';
export * from './categories';

export type Theme = {
  scheme: ColorScheme;
  colors: ColorTokens;
  glass: Record<GlassVariant, GlassTokens>;
  shadow: string;
};

/**
 * Current theme. Follows the system light/dark setting; a user override (Settings) will plug in
 * here later.
 */
export function useTheme(): Theme {
  const scheme: ColorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { scheme, colors: colors[scheme], glass: glass[scheme], shadow: glassShadow[scheme] };
}
