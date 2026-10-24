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
    }
  | {
      /** A neutral filter pill on glass, e.g. "All" in front of the category chips. */
      kind: 'filter';
      label: string;
      accessibilityLabel?: string;
      selected?: boolean;
      onPress: () => void;
    };

/** 44-pt chips reach Android's 48 dp through a small hit slop (rows of chips have 8 pt gaps). */
const CHIP_HIT_SLOP = (48 - layout.touchTarget) / 2;

/**
 * Tappable pill. `category` (default) shows a taxonomy category on its own fill; `more` opens the
 * full category picker; `filter` is a neutral option on glass. Every kind marks selection the same
 * way: a 2 pt border in the chip's text color plus a check, never color alone.
 */
export function CategoryChip(props: CategoryChipProps) {
  const { colors, scheme } = useTheme();

  if (props.kind === 'more' || props.kind === 'filter') {
    const isMore = props.kind === 'more';
    const label = props.label ?? 'More';
    const selected = !isMore && (props.selected ?? false);
    return (
      <Touchable
        onPress={props.onPress}
        feedback="scale"
        hitSlop={CHIP_HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={isMore ? `${label} categories` : (props.accessibilityLabel ?? label)}
        {...(isMore ? {} : { accessibilityState: { selected } })}
      >
        <Glass
          variant="light"
          radius={radius.pill}
          elevation="none"
          fixed
          contentStyle={[
            styles.chip,
            styles.bordered,
            { borderColor: selected ? colors.ink : colors.solidBorder },
          ]}
        >
          {selected ? <Icon name="check" size={iconSize.sm} color={colors.ink} /> : null}
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
      hitSlop={CHIP_HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ selected }}
    >
      <View
        style={[
          styles.chip,
          styles.bordered,
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
  bordered: {
    borderRadius: radius.pill,
    borderWidth: 2,
  },
});
