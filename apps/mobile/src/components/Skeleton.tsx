import { useEffect, useRef, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useReduceMotion } from '@/hooks/useAccessibilitySettings';
import { cardTier, layout, motion, radius, space, useTheme } from '@/theme';

import { CATEGORY_TILE_SIZE } from './CategoryTile';
import { Glass } from './Glass';

/** Softly pulsing opacity shared by a group of placeholder blocks. Static with Reduce Motion. */
function usePulse(): Animated.Value | number {
  const reduceMotion = useReduceMotion();
  const value = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: 0.45,
          duration: motion.pulseMs,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: 1,
          duration: motion.pulseMs,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, value]);
  return reduceMotion ? 1 : value;
}

/** One placeholder block in the track color. */
export function SkeletonBlock({
  width = '100%',
  height = 14,
  rounded = 6,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  rounded?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[{ width, height, borderRadius: rounded, backgroundColor: colors.track }, style]}
    />
  );
}

/**
 * Loading placeholder group. Screen readers hear one "Loading" instead of a pile of blocks; the
 * layout matches what will appear, so nothing jumps when data arrives.
 */
export function Skeleton({
  children,
  label = 'Loading',
  style,
}: {
  children: ReactNode;
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const opacity = usePulse();
  return (
    <Animated.View
      style={[style, { opacity }]}
      accessible
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
    >
      {children}
    </Animated.View>
  );
}

/** Placeholder for a hero card: label, big amount, caption. */
export function SkeletonHero({ label }: { label?: string }) {
  return (
    <Skeleton {...(label ? { label } : {})}>
      <Glass
        variant="strong"
        radius={cardTier.hero.radius}
        contentStyle={[styles.hero, { padding: cardTier.hero.padding }]}
      >
        <SkeletonBlock width="40%" height={16} />
        <SkeletonBlock width="60%" height={40} rounded={10} />
        <SkeletonBlock width="70%" height={12} />
      </Glass>
    </Skeleton>
  );
}

/** Placeholder for a list card of `count` rows (tile, title, caption, trailing amount). */
export function SkeletonList({
  count = 3,
  tile = true,
  label,
}: {
  count?: number;
  tile?: boolean;
  label?: string;
}) {
  return (
    <Skeleton {...(label ? { label } : {})}>
      <Glass variant="light" radius={cardTier.list.radius} contentStyle={styles.list}>
        {Array.from({ length: count }, (_, i) => (
          <View key={i} style={styles.row}>
            {tile ? (
              <SkeletonBlock
                width={CATEGORY_TILE_SIZE}
                height={CATEGORY_TILE_SIZE}
                rounded={radius.tile}
              />
            ) : null}
            <View style={styles.rowText}>
              <SkeletonBlock width="55%" height={14} />
              <SkeletonBlock width="35%" height={11} />
            </View>
            <SkeletonBlock width={56} height={14} />
          </View>
        ))}
      </Glass>
    </Skeleton>
  );
}

const styles = StyleSheet.create({
  hero: { gap: space.md },
  list: {
    paddingHorizontal: layout.listPaddingHorizontal,
    paddingVertical: layout.listPaddingVertical,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.rowMinHeight,
    paddingVertical: layout.rowPaddingVertical,
  },
  rowText: { flex: 1, gap: space.sm },
});
