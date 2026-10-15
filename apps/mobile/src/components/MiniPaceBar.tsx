import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

const TRACK_HEIGHT = 6;
const MARKER_HEIGHT = 12;

const pct = (n: number) => `${Math.round(Math.min(1, Math.max(0, n)) * 100)}%` as const;

/**
 * Compact pace bar for budget rows: accent fill = share spent, ink marker = share of the month
 * gone. Decorative: the row's text and label carry the numbers.
 */
export function MiniPaceBar({
  spentRatio,
  monthRatio,
}: {
  spentRatio: number;
  monthRatio: number;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={styles.area}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <View style={[styles.track, { backgroundColor: colors.track }]}>
        <View style={[styles.fill, { backgroundColor: colors.accent, width: pct(spentRatio) }]} />
      </View>
      <View style={[styles.marker, { backgroundColor: colors.ink, left: pct(monthRatio) }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  area: { height: MARKER_HEIGHT, justifyContent: 'center' },
  track: { height: TRACK_HEIGHT, borderRadius: TRACK_HEIGHT / 2, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: TRACK_HEIGHT / 2 },
  marker: {
    position: 'absolute',
    top: 0,
    width: 2,
    height: MARKER_HEIGHT,
    marginLeft: -1,
    borderRadius: 1,
  },
});
