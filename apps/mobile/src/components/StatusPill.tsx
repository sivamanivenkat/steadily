import { StyleSheet, View } from 'react-native';

import { iconSize, radius, space, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export type PillTone = 'onTrack' | 'headsUp' | 'neutral' | 'accent';

/** Small status pill: icon + text, never color alone. */
export function StatusPill({
  label,
  tone,
  icon,
}: {
  label: string;
  tone: PillTone;
  icon?: IconName;
}) {
  const { colors } = useTheme();
  const palette =
    tone === 'onTrack'
      ? colors.status.onTrack
      : tone === 'headsUp'
        ? colors.headsUp
        : tone === 'accent'
          ? { text: colors.accentInk, bg: colors.accentTint }
          : { text: colors.ink2, bg: colors.neutralTint };
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }]}>
      {icon ? (
        <Icon name={icon} size={iconSize.badge} color={palette.text} strokeWidth={2.4} />
      ) : null}
      <AppText variant="captionStrong" color={palette.text}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    paddingHorizontal: space.sm + 2,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
});
