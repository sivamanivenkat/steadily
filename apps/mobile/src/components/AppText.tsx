import { Text, type TextProps } from 'react-native';

import { maxFontScale, tabularNums, type, useTheme, type TypeStyle } from '@/theme';

type AppTextProps = TextProps & {
  variant?: TypeStyle;
  /** Defaults to `ink`. Pass a token value from `useTheme().colors`. */
  color?: string;
  /** Tabular figures, for numbers that should line up (amounts, counts, percentages). */
  tabular?: boolean;
};

/** Text in the Plus Jakarta Sans type scale. Scales with the system text size. */
export function AppText({
  variant = 'body',
  color,
  tabular = false,
  style,
  ...rest
}: AppTextProps) {
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
      style={[type[variant], tabular && tabularNums, { color: color ?? colors.ink }, style]}
    />
  );
}
