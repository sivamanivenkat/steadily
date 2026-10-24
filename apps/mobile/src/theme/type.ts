import type { TextStyle } from 'react-native';

/**
 * Plus Jakarta Sans families, keyed by weight. The keys match the names registered with
 * `useFonts` in the root layout. Custom fonts carry their weight in the family, so styles set
 * `fontFamily` only (setting `fontWeight` as well makes Android pick a synthetic face).
 */
export const fontFamily = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const;

/** Tabular figures so amounts line up in columns. */
export const tabularNums: TextStyle = { fontVariant: ['tabular-nums'] };

/** Type scale (steadily-ui "Typography"). Letter spacing is in points: em x size. */
export const type = {
  display: {
    fontFamily: fontFamily.extrabold,
    fontSize: 44,
    lineHeight: 52,
    letterSpacing: -1.3,
    ...tabularNums,
  },
  amountL: {
    fontFamily: fontFamily.extrabold,
    fontSize: 34,
    lineHeight: 42,
    letterSpacing: -0.7,
    ...tabularNums,
  },
  title: { fontFamily: fontFamily.extrabold, fontSize: 24, lineHeight: 30, letterSpacing: -0.5 },
  heading: { fontFamily: fontFamily.bold, fontSize: 16, lineHeight: 22 },
  /**
   * The quiet label on top of a card ("Safe to spend", "Amount", "This month"), in ink2 by
   * default. `heading` stays for real headings (merchant, sheet titles).
   */
  cardLabel: { fontFamily: fontFamily.semibold, fontSize: 15, lineHeight: 20 },
  body: { fontFamily: fontFamily.medium, fontSize: 15, lineHeight: 21 },
  bodyStrong: { fontFamily: fontFamily.semibold, fontSize: 15, lineHeight: 21 },
  amount: { fontFamily: fontFamily.bold, fontSize: 15, lineHeight: 21, ...tabularNums },
  caption: { fontFamily: fontFamily.medium, fontSize: 13, lineHeight: 18 },
  captionStrong: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 18 },
  label: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.84,
    textTransform: 'uppercase',
  },
  tab: { fontFamily: fontFamily.semibold, fontSize: 11, lineHeight: 14 },
  tabActive: { fontFamily: fontFamily.bold, fontSize: 11, lineHeight: 14 },
} satisfies Record<string, TextStyle>;

export type TypeStyle = keyof typeof type;

/**
 * Caps for Dynamic Type / font scale on the few styles that are already very large or sit in
 * fixed-height chrome. Everything else scales freely; layouts are built to survive 1.3x and up.
 */
export const maxFontScale = {
  display: 1.4,
  /** Review card amount and the Add amount input: keeps "$" on the same line at 320 pt. */
  amountL: 1.3,
  tab: 1.3,
} as const;
