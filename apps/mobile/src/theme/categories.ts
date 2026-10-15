import {
  FALLBACK_CATEGORY_ID,
  isBuiltInCategoryId,
  type BuiltInCategoryId,
  type CategoryId,
} from '@steadily/taxonomy';

import { withAlpha, type ColorScheme } from './colors';

export type CategoryPalette = {
  /** Light-mode tile/chip fill. */
  fill: string;
  /** Light-mode text and icon stroke on `fill`. */
  ink: string;
  /** Dark-mode icon stroke and category text. */
  darkStroke: string;
};

/**
 * Category colors (steadily-ui "Category colors"). Typed as a full record over the taxonomy's
 * built-in ids, so adding a category to @steadily/taxonomy fails typecheck until it gets colors.
 */
export const categoryPalette = {
  'food.groceries': { fill: '#DDEFD9', ink: '#2F6B3A', darkStroke: '#BFE3B8' },
  'food.dining': { fill: '#FFDCD3', ink: '#A3412B', darkStroke: '#FFC2B2' },
  'food.coffee': { fill: '#F3E3CF', ink: '#7A4E22', darkStroke: '#F3D9B8' },
  'transport.general': { fill: '#D7EAFB', ink: '#1F5C93', darkStroke: '#B5D6F5' },
  'transport.gas': { fill: '#FBF0C4', ink: '#6E5610', darkStroke: '#F2E19A' },
  'shopping.general': { fill: '#EADFFB', ink: '#5F3E9C', darkStroke: '#D3C1F5' },
  'bills.utilities': { fill: '#DCE3F2', ink: '#3A4C78', darkStroke: '#BFCBE8' },
  'housing.rent_mortgage': { fill: '#FFE6D5', ink: '#94512A', darkStroke: '#FFCDAD' },
  'subscriptions.general': { fill: '#DEE1FF', ink: '#3F47A8', darkStroke: '#C3C8FF' },
  'health.general': { fill: '#D3F3EA', ink: '#1E6E5B', darkStroke: '#9FE3CF' },
  'entertainment.general': { fill: '#FCDDEB', ink: '#9A2F64', darkStroke: '#F6BBD6' },
  'travel.general': { fill: '#D2F1F6', ink: '#1B6774', darkStroke: '#A6E2EC' },
  'personal_care.general': { fill: '#F9E0E3', ink: '#8E3A48', darkStroke: '#F2C0C7' },
  'gifts.general': { fill: '#FFE9C9', ink: '#7E5210', darkStroke: '#FFD49A' },
  'other.general': { fill: '#E6E8EE', ink: '#4A5063', darkStroke: '#C9CCD8' },
} as const satisfies Record<BuiltInCategoryId, CategoryPalette>;

/** Opacity of the light fill used for dark-mode tiles. */
const DARK_FILL_ALPHA = 0.14;

export type CategoryColors = {
  /** Tile / chip background. */
  fill: string;
  /** Icon stroke and category text on `fill`. */
  ink: string;
};

/**
 * Resolved colors for a category in the given scheme. Custom categories (`custom.*`) will pick a
 * palette entry once user categories exist; until then they use the fallback category's colors.
 */
export function categoryColors(id: CategoryId, scheme: ColorScheme): CategoryColors {
  const palette = categoryPalette[isBuiltInCategoryId(id) ? id : FALLBACK_CATEGORY_ID];
  return scheme === 'dark'
    ? { fill: withAlpha(palette.fill, DARK_FILL_ALPHA), ink: palette.darkStroke }
    : { fill: palette.fill, ink: palette.ink };
}
