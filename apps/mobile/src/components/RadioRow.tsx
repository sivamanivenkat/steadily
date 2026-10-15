import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { iconSize, layout, radius, space, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';

type RadioRowProps = {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  /** Optional leading visual, e.g. a category tile. */
  leading?: ReactNode;
};

/** One option in a single-choice list. Selection shows as a filled check, not color alone. */
export function RadioRow({ label, description, selected, onPress, leading }: RadioRowProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: selected, selected }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {leading}
      <View style={styles.text}>
        <AppText variant="bodyStrong">{label}</AppText>
        {description ? (
          <AppText variant="caption" color={colors.ink2}>
            {description}
          </AppText>
        ) : null}
      </View>
      <View
        style={[
          styles.dot,
          selected
            ? { backgroundColor: colors.accent, borderColor: colors.accent }
            : { borderColor: colors.solidBorder },
        ]}
      >
        {selected ? <Icon name="check" size={iconSize.badge} color={colors.onAccent} /> : null}
      </View>
    </Pressable>
  );
}

const DOT = 22;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.touchTarget + space.sm,
    paddingVertical: layout.rowPaddingVertical,
  },
  text: { flex: 1, gap: 2 },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
});
