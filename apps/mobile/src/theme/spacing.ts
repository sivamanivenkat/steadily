/** 4-pt grid (steadily-ui "Spacing"). */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const layout = {
  /** Horizontal screen padding (16 on dense screens). */
  screenPadding: 20,
  screenPaddingDense: 16,
  /** Inner padding of glass cards. */
  cardPadding: 20,
  /** Gap between stacked cards. */
  cardGap: 14,
  /** Vertical padding inside list rows. */
  rowPaddingVertical: 10,
  /** Minimum height of a list row (40 tile + row padding), so rows line up across screens. */
  rowMinHeight: 56,
  /** Horizontal padding of a list card; rows run edge to edge inside it. */
  listPaddingHorizontal: 16,
  /** Vertical padding of a list card around its first and last row. */
  listPaddingVertical: 4,
  /** Extra space above a section label, on top of the screen's card gap. */
  sectionGap: 12,
  /** Pulls a section label toward the content it labels (label-to-content is tighter). */
  sectionLabelPull: -4,
  /** Minimum touch target edge (iOS HIG 44pt; Android 48dp is met by padding where needed). */
  touchTarget: 44,
  /** Widest a text-heavy screen's column gets on tablets and landscape, so lines stay readable. */
  readableWidth: 640,
} as const;

/**
 * Card tiers: one shape and padding per level of importance, so screens stop hand-tuning them.
 * - `hero`: the one key number on a screen (strong glass, raised).
 * - `standard`: secondary cards with text and actions (light glass, soft shadow).
 * - `list`: a container of rows separated by hairlines (light glass, soft shadow).
 * - `inset`: a quiet surface inside a card or a form field (light glass, flat).
 */
export const cardTier = {
  hero: { radius: 28, padding: 22 },
  standard: { radius: 24, padding: 20 },
  list: { radius: 24, padding: 0 },
  inset: { radius: 16, padding: 16 },
} as const;

export type CardTier = keyof typeof cardTier;

export const radius = {
  card: 28,
  cardSmall: 24,
  toast: 22,
  row: 16,
  button: 14,
  tile: 14,
  pill: 999,
} as const;

export const iconSize = {
  badge: 12,
  sm: 16,
  md: 20,
  lg: 22,
} as const;

/** Stroke width for line icons at 20-22 px. */
export const iconStroke = 2;

export const tabBar = {
  height: 68,
  inset: 20,
  radius: 34,
  /** Breathing room between the last content row and the top of the floating bar. */
  contentGap: 24,
} as const;
