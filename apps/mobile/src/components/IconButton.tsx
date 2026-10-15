import { Pressable, StyleSheet } from 'react-native';

import { iconSize, layout, radius, useTheme } from '@/theme';

import { Glass } from './Glass';
import { Icon, type IconName } from './Icon';

type IconButtonProps = {
  icon: IconName;
  /** Required: the button has no visible text. */
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress: () => void;
};

/** 44x44 circular glass button for icon-only actions. */
export function IconButton({
  icon,
  accessibilityLabel,
  accessibilityHint,
  onPress,
}: IconButtonProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      hitSlop={4}
      style={({ pressed }) => [styles.target, pressed && styles.pressed]}
    >
      <Glass variant="light" radius={radius.pill} fixed contentStyle={styles.circle}>
        <Icon name={icon} size={iconSize.md} color={colors.ink} />
      </Glass>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: {
    width: layout.touchTarget,
    height: layout.touchTarget,
  },
  circle: {
    width: layout.touchTarget,
    height: layout.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
});
