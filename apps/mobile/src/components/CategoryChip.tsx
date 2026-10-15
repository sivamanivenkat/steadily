import { getBuiltInCategory, isBuiltInCategoryId, type CategoryId } from '@steadily/taxonomy';
import { Pressable, StyleSheet, View } from 'react-native';

import { categoryColors, iconSize, layout, radius, space, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Glass } from './Glass';
import { Icon } from './Icon';

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
      <Pressable
        onPress={props.onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label} categories`}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <Glass variant="light" radius={radius.pill} shadow={false} fixed contentStyle={styles.chip}>
          <AppText variant="bodyStrong">{label}</AppText>
        </Glass>
      </Pressable>
    );
  }

  const { categoryId, selected = false, onPress } = props;
  const name = isBuiltInCategoryId(categoryId)
    ? getBuiltInCategory(categoryId).name
    : (props.label ?? 'Custom');
  const tint = categoryColors(categoryId, scheme);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ selected }}
      style={({ pressed }) => pressed && styles.pressed}
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
    </Pressable>
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
  pressed: { opacity: 0.7 },
});
