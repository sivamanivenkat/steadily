import { StyleSheet, View } from 'react-native';

import { iconSize, radius, useTheme, type ColorTokens } from '@/theme';

import { Icon, type IconName } from './Icon';

export type IconTone = 'accent' | 'headsUp' | 'onTrack' | 'neutral';

/** Text/background pair for a tone. Every pair is a 4.5:1 token pairing. */
export function tonePalette(colors: ColorTokens, tone: IconTone): { text: string; bg: string } {
  switch (tone) {
    case 'accent':
      return { text: colors.accentInk, bg: colors.accentTint };
    case 'headsUp':
      return colors.headsUp;
    case 'onTrack':
      return colors.status.onTrack;
    case 'neutral':
      return { text: colors.ink2, bg: colors.neutralTint };
  }
}

const SIZE = { md: 40, lg: 48 } as const;

/**
 * Tinted tile with a stroke icon, the non-category sibling of `CategoryTile` (review queue,
 * "whole month", empty states). Decorative: the row or card next to it carries the meaning.
 */
export function IconTile({
  icon,
  tone = 'neutral',
  size = 'md',
  round = false,
}: {
  icon: IconName;
  tone?: IconTone;
  size?: keyof typeof SIZE;
  round?: boolean;
}) {
  const { colors } = useTheme();
  const palette = tonePalette(colors, tone);
  const edge = SIZE[size];
  return (
    <View
      style={[
        styles.tile,
        {
          width: edge,
          height: edge,
          borderRadius: round ? radius.pill : radius.tile,
          backgroundColor: palette.bg,
        },
      ]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Icon name={icon} size={size === 'lg' ? iconSize.lg : iconSize.md} color={palette.text} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center' },
});
