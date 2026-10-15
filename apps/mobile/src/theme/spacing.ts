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
  /** Minimum touch target edge (iOS HIG 44pt; Android 48dp is met by padding where needed). */
  touchTarget: 44,
} as const;

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
} as const;
