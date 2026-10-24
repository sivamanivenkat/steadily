import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { iconSize, layout, radius, space, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Glass } from './Glass';
import { Icon, type IconName } from './Icon';
import { Touchable } from './Touchable';

export type ButtonVariant = 'primary' | 'secondary' | 'accentTint' | 'neutralTint' | 'link';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  /** Work in progress: shows a spinner, announces busy and ignores taps. */
  loading?: boolean;
  accessibilityLabel?: string | undefined;
  accessibilityHint?: string | undefined;
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
  loading = false,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: ButtonProps) {
  const { colors } = useTheme();
  const inactive = disabled || loading;

  const textColor =
    variant === 'primary'
      ? colors.onAccent
      : variant === 'accentTint' || variant === 'link'
        ? colors.accentInk
        : colors.ink;

  const content = (
    <>
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : icon ? (
        <Icon name={icon} size={iconSize.md} color={textColor} />
      ) : null}
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
        elevation="none"
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
    <Touchable
      onPress={onPress}
      disabled={inactive}
      feedback={variant === 'link' ? 'opacity' : 'scale'}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      testID={testID}
      style={[style, disabled && !loading && styles.disabled]}
    >
      {body}
    </Touchable>
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
  disabled: { opacity: 0.45 },
});
