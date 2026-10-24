import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { useReduceMotion } from '@/hooks/useAccessibilitySettings';
import { iconSize, radius, space, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';

export type PaceStatus = 'onTrack' | 'ahead';

/** Spending more than this far ahead of the calendar counts as "a little ahead". */
const AHEAD_TOLERANCE = 0.02;

export function paceStatus(spentRatio: number, monthRatio: number): PaceStatus {
  return spentRatio > monthRatio + AHEAD_TOLERANCE ? 'ahead' : 'onTrack';
}

const STATUS_LABEL: Record<PaceStatus, string> = {
  onTrack: 'On track',
  ahead: 'A little ahead',
};

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const pct = (n: number) => Math.round(clamp(n) * 100);

const FILL_DURATION_MS = 600;
const TRACK_HEIGHT = 10;
const MARKER_HEIGHT = 18;

type PaceBarProps = {
  /** Share of the period budget spent, 0-1. */
  spentRatio: number;
  /** Share of the period elapsed, 0-1. */
  monthRatio: number;
};

/**
 * Spending pace: accent fill = share of budget spent; the ink marker = share of the month gone.
 * Status is spelled out in text, never by color alone.
 */
export function PaceBar({ spentRatio, monthRatio }: PaceBarProps) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const status = paceStatus(spentRatio, monthRatio);
  const statusColors = colors.status[status];
  const spent = clamp(spentRatio);

  const progress = useRef(new Animated.Value(reduceMotion ? spent : 0)).current;
  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(spent);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: spent,
      duration: FILL_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, spent, reduceMotion]);

  return (
    <View
      style={styles.root}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Spending pace. ${pct(spentRatio)}% of budget spent, ${pct(monthRatio)}% of the month gone. ${STATUS_LABEL[status]}.`}
      accessibilityValue={{ min: 0, max: 100, now: pct(spentRatio) }}
    >
      <View style={[styles.statusPill, { backgroundColor: statusColors.bg }]}>
        <Icon
          name={status === 'ahead' ? 'arrowUp' : 'check'}
          size={iconSize.badge}
          color={statusColors.text}
          strokeWidth={2.4}
        />
        <AppText variant="captionStrong" color={statusColors.text}>
          {STATUS_LABEL[status]}
        </AppText>
      </View>

      <View style={styles.barArea}>
        <View style={[styles.track, { backgroundColor: colors.track }]}>
          <Animated.View
            style={[
              styles.fill,
              { backgroundColor: colors.accent, transform: [{ scaleX: progress }] },
            ]}
          />
        </View>
        <View
          style={[styles.marker, { backgroundColor: colors.ink, left: `${pct(monthRatio)}%` }]}
        />
      </View>

      <View style={styles.legend}>
        <AppText variant="captionStrong" tabular>
          {pct(spentRatio)}% spent
        </AppText>
        <AppText variant="caption" color={colors.ink2} tabular>
          {pct(monthRatio)}% of month
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.md },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    paddingHorizontal: space.sm + 2,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
  barArea: {
    height: MARKER_HEIGHT,
    justifyContent: 'center',
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    overflow: 'hidden',
  },
  fill: {
    ...StyleSheet.absoluteFill,
    borderRadius: TRACK_HEIGHT / 2,
    transformOrigin: 'left',
  },
  marker: {
    position: 'absolute',
    top: 0,
    width: 2,
    height: MARKER_HEIGHT,
    marginLeft: -1,
    borderRadius: 1,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: space.sm,
  },
});
