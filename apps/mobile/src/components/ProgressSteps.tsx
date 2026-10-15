import { StyleSheet, View } from 'react-native';

import { space, useTheme } from '@/theme';

import { AppText } from './AppText';

const SEGMENT_HEIGHT = 4;

/** Segmented progress for multi-step flows, with "Step 2 of 5" spelled out. */
export function ProgressSteps({ current, total }: { current: number; total: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={styles.root}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${current} of ${total}`}
      accessibilityValue={{ min: 1, max: total, now: current }}
    >
      <View style={styles.segments}>
        {Array.from({ length: total }, (_, i) => (
          <View
            key={i}
            style={[
              styles.segment,
              { backgroundColor: i < current ? colors.accent : colors.track },
            ]}
          />
        ))}
      </View>
      <AppText variant="captionStrong" color={colors.ink2}>
        Step {current} of {total}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.xs + 2 },
  segments: { flexDirection: 'row', gap: space.xs },
  segment: { flex: 1, height: SEGMENT_HEIGHT, borderRadius: SEGMENT_HEIGHT / 2 },
});
