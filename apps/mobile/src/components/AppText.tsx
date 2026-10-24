import { Text, type TextProps } from 'react-native';

import { maxFontScale, tabularNums, type, useTheme, type TypeStyle } from '@/theme';

type AppTextProps = TextProps & {
  variant?: TypeStyle;
  /** Defaults to `ink` (`ink2` for `cardLabel`). Pass a token value from `useTheme().colors`. */
  color?: string;
  /** Tabular figures, for numbers that should line up (amounts, counts, percentages). */
  tabular?: boolean;
};

function capFor(variant: TypeStyle): number | undefined {
  if (variant === 'display') return maxFontScale.display;
  if (variant === 'amountL') return maxFontScale.amountL;
  if (variant.startsWith('tab')) return maxFontScale.tab;
  return undefined;
}

/** Text in the Plus Jakarta Sans type scale. Scales with the system text size. */
export function AppText({
  variant = 'body',
  color,
  tabular = false,
  style,
  ...rest
}: AppTextProps) {
  const { colors } = useTheme();
  const fallback = variant === 'cardLabel' ? colors.ink2 : colors.ink;
  return (
    <Text
      maxFontSizeMultiplier={capFor(variant)}
      {...rest}
      style={[type[variant], tabular && tabularNums, { color: color ?? fallback }, style]}
    />
  );
}
