import { getBuiltInCategory, isBuiltInCategoryId, type CategoryId } from '@steadily/taxonomy';
import { StyleSheet, View } from 'react-native';

import { categoryColors, iconSize, layout, radius, space, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Glass } from './Glass';
import { Icon } from './Icon';
import { Touchable } from './Touchable';

type CategoryChipProps =
  | {
      kind?: 'category';
      categoryId: CategoryId;
      /** Display name for custom categories; built-ins use the taxonomy name. */
      label?: string;
      selected?: boolean;
      onPress: () => void;
    }
  | {
      kind: 'more';
      label?: string;
      onPress: () => void;
    };

/** Tappable category pill. The "more" variant opens the full category picker. */
export function CategoryChip(props: CategoryChipProps) {
  const { colors, scheme } = useTheme();

  if (props.kind === 'more') {
    const label = props.label ?? 'More';
    return (
      <Touchable
        onPress={props.onPress}
        feedback="scale"
        accessibilityRole="button"
        accessibilityLabel={`${label} categories`}
      >
        <Glass
          variant="light"
          radius={radius.pill}
          elevation="none"
          fixed
          contentStyle={[styles.chip, styles.moreChip, { borderColor: colors.solidBorder }]}
        >
          <AppText variant="bodyStrong">{label}</AppText>
        </Glass>
      </Touchable>
    );
  }

  const { categoryId, selected = false, onPress } = props;
  const name = isBuiltInCategoryId(categoryId)
    ? getBuiltInCategory(categoryId).name
    : (props.label ?? 'Custom');
  const tint = categoryColors(categoryId, scheme);

  return (
    <Touchable
      onPress={onPress}
      feedback="scale"
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ selected }}
    >
      <View
        style={[
          styles.chip,
          styles.categoryChip,
          { backgroundColor: tint.fill, borderColor: selected ? tint.ink : 'transparent' },
        ]}
      >
        {selected ? <Icon name="check" size={iconSize.sm} color={tint.ink} /> : null}
        <AppText variant="bodyStrong" color={tint.ink}>
          {name}
        </AppText>
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: layout.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs + 2,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  categoryChip: {
    borderRadius: radius.pill,
    borderWidth: 2,
  },
  moreChip: { borderWidth: 2 },
});
