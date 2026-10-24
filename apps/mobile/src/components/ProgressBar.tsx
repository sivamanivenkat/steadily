import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useReduceMotion } from '@/hooks/useAccessibilitySettings';
import { useTheme } from '@/theme';

const TRACK_HEIGHT = 10;
const FILL_MS = 300;

const clamp = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

type ProgressBarProps = {
  /** Share done, 0-1. */
  value: number;
  /** Spoken name, e.g. "Import progress". */
  accessibilityLabel: string;
  /** Spoken value; defaults to the percentage. */
  valueText?: string;
  /** Fill color; defaults to `accent`. */
  color?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Rounded track with an accent fill (the PaceBar track, without the pace marker). The fill eases
 * to each new value on the native thread; with Reduce Motion it jumps.
 */
export function ProgressBar({
  value,
  accessibilityLabel,
  valueText,
  color,
  style,
}: ProgressBarProps) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const ratio = clamp(value);
  const progress = useRef(new Animated.Value(ratio)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(ratio);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: ratio,
      duration: FILL_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, ratio, reduceMotion]);

  const percent = Math.round(ratio * 100);
  return (
    <View
      style={[styles.track, { backgroundColor: colors.track }, style]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: percent, text: valueText ?? `${percent}%` }}
    >
      <Animated.View
        style={[
          styles.fill,
          { backgroundColor: color ?? colors.accent, transform: [{ scaleX: progress }] },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: TRACK_HEIGHT, borderRadius: TRACK_HEIGHT / 2, overflow: 'hidden' },
  fill: { ...StyleSheet.absoluteFill, borderRadius: TRACK_HEIGHT / 2, transformOrigin: 'left' },
});
