import { StyleSheet } from 'react-native';

import { iconSize, layout, radius, useTheme } from '@/theme';

import { Glass } from './Glass';
import { Icon, type IconName } from './Icon';
import { Touchable } from './Touchable';

type IconButtonProps = {
  icon: IconName;
  /** Required: the button has no visible text. */
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress: () => void;
  disabled?: boolean;
  /** No shadow, for icon buttons that sit inside another glass surface. */
  flat?: boolean;
};

/** 44x44 circular glass button for icon-only actions. */
export function IconButton({
  icon,
  accessibilityLabel,
  accessibilityHint,
  onPress,
  disabled = false,
  flat = false,
}: IconButtonProps) {
  const { colors } = useTheme();
  return (
    <Touchable
      onPress={onPress}
      feedback="scale"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      style={[styles.target, disabled && styles.disabled]}
    >
      <Glass
        variant="light"
        radius={radius.pill}
        elevation={flat ? 'none' : 'soft'}
        fixed
        contentStyle={styles.circle}
      >
        <Icon name={icon} size={iconSize.md} color={colors.ink} />
      </Glass>
    </Touchable>
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
  disabled: { opacity: 0.4 },
});
