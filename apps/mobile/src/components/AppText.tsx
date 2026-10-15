import { Text, type TextProps } from 'react-native';

import { maxFontScale, type, useTheme, type TypeStyle } from '@/theme';

type AppTextProps = TextProps & {
  variant?: TypeStyle;
  /** Defaults to `ink`. Pass a token value from `useTheme().colors`. */
  color?: string;
};

/** Text in the Plus Jakarta Sans type scale. Scales with the system text size. */
export function AppText({ variant = 'body', color, style, ...rest }: AppTextProps) {
  const { colors } = useTheme();
  const cap =
    variant === 'display'
      ? maxFontScale.display
      : variant.startsWith('tab')
        ? maxFontScale.tab
        : undefined;
  return (
    <Text
      maxFontSizeMultiplier={cap}
      {...rest}
      style={[type[variant], { color: color ?? colors.ink }, style]}
    />
  );
}
