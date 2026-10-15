import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { iconSize, layout, radius, space, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Glass } from './Glass';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'accentTint' | 'neutralTint' | 'link';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Text button. `primary` is the one filled accent action on a screen; `secondary` sits on light
 * glass; the tint variants are for secondary actions on cards (review card "Split", "Not an
 * expense"); `link` is text only.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: ButtonProps) {
  const { colors } = useTheme();

  const textColor =
    variant === 'primary'
      ? colors.onAccent
      : variant === 'accentTint' || variant === 'link'
        ? colors.accentInk
        : colors.ink;

  const content = (
    <>
      {icon ? <Icon name={icon} size={iconSize.md} color={textColor} /> : null}
      <AppText variant="bodyStrong" color={textColor} style={styles.label}>
        {label}
      </AppText>
    </>
  );

  let body;
  if (variant === 'secondary') {
    body = (
      <Glass
        variant="light"
        radius={radius.button}
        shadow={false}
        fixed
        contentStyle={styles.inner}
      >
        {content}
      </Glass>
    );
  } else {
    const backgroundColor =
      variant === 'primary'
        ? colors.accent
        : variant === 'accentTint'
          ? colors.accentTint
          : variant === 'neutralTint'
            ? colors.neutralTint
            : 'transparent';
    body = <View style={[styles.inner, styles.solid, { backgroundColor }]}>{content}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      testID={testID}
      style={({ pressed }) => [
        style,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  inner: {
    minHeight: layout.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm + 2,
  },
  solid: { borderRadius: radius.button },
  label: { textAlign: 'center', flexShrink: 1 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
});
