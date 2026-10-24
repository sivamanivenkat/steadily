import { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';

import { colors, type ColorScheme, type ColorTokens } from './colors';
import {
  glass,
  glassShadow,
  glassShadows,
  type Elevation,
  type GlassTokens,
  type GlassVariant,
} from './glass';

export * from './colors';
export * from './glass';
export * from './type';
export * from './spacing';
export * from './motion';
export * from './categories';

export type Theme = {
  scheme: ColorScheme;
  colors: ColorTokens;
  glass: Record<GlassVariant, GlassTokens>;
  /** The hero (`raised`) shadow. */
  shadow: string;
  shadows: Record<Exclude<Elevation, 'none'>, string>;
};

/** The user's choice in Settings. `system` follows the phone's light/dark setting. */
export type ThemePreference = 'system' | 'light' | 'dark';

/**
 * Carries the Settings theme override down the tree. Without a provider (component tests) the
 * theme follows the system setting.
 */
export const ThemePreferenceContext = createContext<ThemePreference>('system');

export function resolveScheme(
  preference: ThemePreference,
  system: string | null | undefined,
): ColorScheme {
  if (preference !== 'system') return preference;
  return system === 'dark' ? 'dark' : 'light';
}

export function themeFor(scheme: ColorScheme): Theme {
  return {
    scheme,
    colors: colors[scheme],
    glass: glass[scheme],
    shadow: glassShadow[scheme],
    shadows: glassShadows[scheme],
  };
}

/** Current theme: the Settings override if there is one, otherwise the system light/dark setting. */
export function useTheme(): Theme {
  const preference = useContext(ThemePreferenceContext);
  const system = useColorScheme();
  return themeFor(resolveScheme(preference, system));
}
