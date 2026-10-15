import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { layout, space, useTheme } from '@/theme';

import { AppText } from './AppText';

type ToggleRowProps = {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  testID?: string;
};

/** A whole-row switch: the row is the control, so the hit area is large and it reads as one. */
export function ToggleRow({ label, description, value, onValueChange, testID }: ToggleRowProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value }}
      testID={testID}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.text}>
        <AppText variant="bodyStrong">{label}</AppText>
        {description ? (
          <AppText variant="caption" color={colors.ink2}>
            {description}
          </AppText>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.solidBorder, true: colors.accent }}
        thumbColor={colors.solidSurface}
        ios_backgroundColor={colors.solidBorder}
        accessible={false}
        importantForAccessibility="no"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.touchTarget + space.sm,
    paddingVertical: layout.rowPaddingVertical,
  },
  text: { flex: 1, gap: 2 },
  pressed: { opacity: 0.7 },
});
