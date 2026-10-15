import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useTheme, withAlpha } from '@/theme';

/** Glow centers, in the order of `colors.glows`: top-left, top-right, bottom-left, bottom-right. */
const GLOW_POSITIONS = [
  { cx: '0%', cy: '0%' },
  { cx: '100%', cy: '8%' },
  { cx: '0%', cy: '100%' },
  { cx: '100%', cy: '92%' },
] as const;

/**
 * Pastel ground with soft corner glows. Static: it sits behind scrolling content and never moves.
 */
export function ScreenBackground({ children }: { children?: ReactNode }) {
  const { colors, scheme } = useTheme();
  // A gentle top-to-bottom wash so the ground is not flat between the glows.
  const wash =
    scheme === 'dark' ? withAlpha(colors.ground, 0) : withAlpha(colors.solidSurface, 0.55);

  return (
    <View style={[styles.root, { backgroundColor: colors.ground }]}>
      <LinearGradient
        style={StyleSheet.absoluteFill}
        colors={[wash, withAlpha(colors.ground, 0)]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.6 }}
        pointerEvents="none"
      />
      <Svg
        style={StyleSheet.absoluteFill}
        width="100%"
        height="100%"
        pointerEvents="none"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      >
        <Defs>
          {GLOW_POSITIONS.map((pos, i) => (
            <RadialGradient key={i} id={`glow${i}`} cx={pos.cx} cy={pos.cy} rx="75%" ry="45%">
              <Stop offset="0" stopColor={colors.glows[i]} stopOpacity={1} />
              <Stop offset="1" stopColor={colors.glows[i]} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        {GLOW_POSITIONS.map((_, i) => (
          <Rect key={i} x="0" y="0" width="100%" height="100%" fill={`url(#glow${i})`} />
        ))}
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
