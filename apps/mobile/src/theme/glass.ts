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

/**
 * How far a surface lifts off the ground. `raised` is the hero tier (safe-to-spend, review card,
 * sheets, tab bar): anything carrying a key amount. `soft` is for lists and secondary cards so they
 * sit a step below the hero instead of competing with it. `none` is for surfaces inside a card.
 */
export type Elevation = 'raised' | 'soft' | 'none';

/** CSS-style `boxShadow` values (supported by React Native's new architecture). */
export const glassShadows: Record<ColorScheme, Record<Exclude<Elevation, 'none'>, string>> = {
  light: {
    raised: '0px 14px 40px rgba(60,70,120,0.12)',
    soft: '0px 6px 20px rgba(60,70,120,0.07)',
  },
  dark: {
    raised: '0px 16px 40px rgba(0,0,0,0.35)',
    soft: '0px 8px 24px rgba(0,0,0,0.22)',
  },
};

/** The hero shadow. Kept for callers that only need the one value. */
export const glassShadow: Record<ColorScheme, string> = {
  light: glassShadows.light.raised,
  dark: glassShadows.dark.raised,
};

/** Default elevation per glass variant: key amounts lift, lists stay low. */
export const defaultElevation: Record<GlassVariant, Elevation> = {
  strong: 'raised',
  light: 'soft',
};
