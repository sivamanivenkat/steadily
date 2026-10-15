import { getBuiltInCategory, isBuiltInCategoryId, type CategoryId } from '@steadily/taxonomy';
import { StyleSheet, View } from 'react-native';

import { categoryColors, iconSize, radius, useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';

export const CATEGORY_TILE_SIZE = 40;

/** Name and icon for any category id; custom ids use the given name and the dots icon. */
export function categoryMeta(
  id: CategoryId,
  fallbackName?: string,
): { name: string; icon: IconName } {
  if (isBuiltInCategoryId(id)) {
    const category = getBuiltInCategory(id);
    return { name: category.name, icon: category.icon };
  }
  return { name: fallbackName ?? 'Custom', icon: 'dots' };
}

/** 40x40 rounded tile in the category fill with its stroke icon. Decorative. */
export function CategoryTile({ categoryId, icon }: { categoryId: CategoryId; icon?: IconName }) {
  const { scheme } = useTheme();
  const tint = categoryColors(categoryId, scheme);
  return (
    <View style={[styles.tile, { backgroundColor: tint.fill }]}>
      <Icon name={icon ?? categoryMeta(categoryId).icon} size={iconSize.md} color={tint.ink} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: CATEGORY_TILE_SIZE,
    height: CATEGORY_TILE_SIZE,
    borderRadius: radius.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
