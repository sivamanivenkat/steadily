/**
 * Calm Glass color tokens (D-023). Values come from the steadily-ui skill.
 * Screens and components import these; they never hard-code a color.
 */

export type ColorScheme = 'light' | 'dark';

export type ColorTokens = {
  /** Screen base. */
  ground: string;
  /** Soft radial glows at the screen corners (top-left, top-right, bottom-left, bottom-right). */
  glows: readonly [string, string, string, string];
  /** Primary text and amounts. */
  ink: string;
  /** Secondary text and captions. */
  ink2: string;
  /** Primary actions, active tab, pace fill. */
  accent: string;
  /** Accent text and links. */
  accentInk: string;
  /** Text and icons on a filled `accent` button (4.5:1 or better). */
  onAccent: string;
  /** Soft accent wash behind accent-tinted secondary actions. */
  accentTint: string;
  /** Soft neutral wash behind neutral secondary actions. */
  neutralTint: string;
  /** Success marks (on-track icon, saved toast check). */
  onTrack: string;
  headsUp: { text: string; bg: string };
  onDevice: { text: string; bg: string };
  /** Status pills. Text/bg pairs chosen for 4.5:1 contrast at caption size. */
  status: {
    onTrack: { text: string; bg: string };
    ahead: { text: string; bg: string };
  };
  hairline: string;
  track: string;
  /** Reduce Transparency fallback surfaces. */
  solidSurface: string;
  solidBorder: string;
  /** Dims the screen behind a bottom sheet so the sheet reads as the only thing in front. */
  scrim: string;
  /**
   * Actions that delete data and cannot be undone. `fill` + `onFill` for the filled button,
   * `text` for links and icons on glass, `tint` behind a destructive icon tile. All 4.5:1 or better.
   */
  destructive: { fill: string; onFill: string; text: string; tint: string };
};

export const lightColors: ColorTokens = {
  ground: '#F5F6FB',
  // mint, lavender, peach, sky
  glows: ['#CFF5E7', '#E3DCFF', '#FFE2D1', '#D6ECFF'],
  ink: '#1E2235',
  ink2: '#4E556E',
  accent: '#4F5BD5',
  accentInk: '#3F47A8',
  onAccent: '#FFFFFF',
  accentTint: 'rgba(79,91,213,0.12)',
  neutralTint: 'rgba(30,34,53,0.06)',
  onTrack: '#2E8B6E',
  headsUp: { text: '#8A520F', bg: '#FFE9C9' },
  onDevice: { text: '#1E6E5B', bg: '#D3F3EA' },
  status: {
    onTrack: { text: '#1E6E5B', bg: '#D3F3EA' },
    ahead: { text: '#8A520F', bg: '#FFE9C9' },
  },
  hairline: 'rgba(30,34,53,0.06)',
  track: 'rgba(30,34,53,0.08)',
  solidSurface: '#FFFFFF',
  solidBorder: '#E4E6F0',
  scrim: 'rgba(30,34,53,0.32)',
  destructive: {
    fill: '#B42318',
    onFill: '#FFFFFF',
    text: '#A61F15',
    tint: 'rgba(180,35,24,0.10)',
  },
};

export const darkColors: ColorTokens = {
  ground: '#0F1222',
  // teal, indigo, plum, blue
  glows: [
    'rgba(30,110,91,0.45)',
    'rgba(79,91,213,0.45)',
    'rgba(154,47,100,0.32)',
    'rgba(31,92,147,0.38)',
  ],
  ink: '#EEF0FA',
  ink2: '#A9AEC8',
  accent: '#9DA6FF',
  accentInk: '#B9C0FF',
  onAccent: '#0F1222',
  accentTint: 'rgba(157,166,255,0.16)',
  neutralTint: 'rgba(255,255,255,0.08)',
  // Dark has no dedicated success value in the spec; reuse the on-device green.
  onTrack: '#9FE3CF',
  headsUp: { text: '#FFD49A', bg: 'rgba(255,212,154,0.14)' },
  onDevice: { text: '#9FE3CF', bg: 'rgba(159,227,207,0.14)' },
  status: {
    onTrack: { text: '#9FE3CF', bg: 'rgba(159,227,207,0.14)' },
    ahead: { text: '#FFD49A', bg: 'rgba(255,212,154,0.14)' },
  },
  hairline: 'rgba(255,255,255,0.07)',
  track: 'rgba(255,255,255,0.10)',
  solidSurface: '#1C2038',
  solidBorder: '#2C3152',
  scrim: 'rgba(5,7,16,0.6)',
  destructive: {
    fill: '#FFB4AB',
    onFill: '#0F1222',
    text: '#FFB4AB',
    tint: 'rgba(255,180,171,0.14)',
  },
};

export const colors: Record<ColorScheme, ColorTokens> = {
  light: lightColors,
  dark: darkColors,
};

/** `#RRGGBB` + opacity -> `rgba(...)`. Used for derived tints (e.g. dark category tiles). */
export function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`withAlpha expects #RRGGBB, got ${hex}`);
  const n = parseInt(match[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
