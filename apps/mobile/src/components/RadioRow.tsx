import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { iconSize, layout, radius, space, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';
import { Touchable } from './Touchable';

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
    <Touchable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: selected, selected }}
      style={styles.row}
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
    </Touchable>
  );
}

const DOT = 22;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.rowMinHeight,
    paddingVertical: layout.rowPaddingVertical,
  },
  text: { flex: 1, minWidth: 0, gap: space.xxs },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
