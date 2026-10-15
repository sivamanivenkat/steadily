import type { ColorScheme } from './colors';

export type GlassVariant = 'light' | 'strong';

export type GlassTokens = {
  /** Tint laid over the blur (or the whole surface when blur is unavailable). */
  background: string;
  border: string;
  /** expo-blur intensity (1-100). */
  blurIntensity: number;
};

/**
 * Glass surfaces (steadily-ui "Glass surfaces"). `strong` carries anything with a key amount;
 * `light` is for lists, chips, secondary cards and buttons.
 */
export const glass: Record<ColorScheme, Record<GlassVariant, GlassTokens>> = {
  light: {
    light: {
      background: 'rgba(255,255,255,0.58)',
      border: 'rgba(255,255,255,0.82)',
      blurIntensity: 24,
    },
    strong: {
      background: 'rgba(255,255,255,0.82)',
      border: 'rgba(255,255,255,0.92)',
      blurIntensity: 24,
    },
  },
  dark: {
    light: {
      background: 'rgba(34,38,66,0.55)',
      border: 'rgba(255,255,255,0.12)',
      blurIntensity: 24,
    },
    strong: {
      background: 'rgba(40,45,78,0.80)',
      border: 'rgba(255,255,255,0.16)',
      blurIntensity: 24,
    },
  },
};

/** CSS-style `boxShadow` values (supported by React Native's new architecture). */
export const glassShadow: Record<ColorScheme, string> = {
  light: '0px 14px 40px rgba(60,70,120,0.12)',
  dark: '0px 16px 40px rgba(0,0,0,0.35)',
};
