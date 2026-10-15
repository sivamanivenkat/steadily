import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';

import { useReduceMotion } from '@/hooks/useAccessibilitySettings';

const DURATION_MS = 240;
const OFFSET = 28;

/**
 * Fades its content in, sliding from the right. With Reduce Motion it only fades. Give it a new
 * `key` to replay (e.g. the next review card).
 */
export function EntranceView({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress]);

  const translateX = reduceMotion
    ? 0
    : progress.interpolate({ inputRange: [0, 1], outputRange: [OFFSET, 0] });

  return (
    <Animated.View style={[style, { opacity: progress, transform: [{ translateX }] }]}>
      {children}
    </Animated.View>
  );
}
