import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';

import { useReduceMotion } from '@/hooks/useAccessibilitySettings';
import { motion } from '@/theme';

/**
 * Fades its content in while it springs in from the right (damping 18, stiffness 180, clamped so
 * amounts never bounce). With Reduce Motion it only fades. Give it a new `key` to replay (e.g. the
 * next review card).
 */
export function EntranceView({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  const offset = useRef(new Animated.Value(reduceMotion ? 0 : motion.enterOffset)).current;

  useEffect(() => {
    const fade = Animated.timing(opacity, {
      toValue: 1,
      duration: motion.enterFadeMs,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    const animation = reduceMotion
      ? fade
      : Animated.parallel([
          fade,
          Animated.spring(offset, {
            toValue: 0,
            ...motion.spring,
            overshootClamping: true,
            useNativeDriver: true,
          }),
        ]);
    if (reduceMotion) offset.setValue(0);
    animation.start();
    return () => animation.stop();
  }, [opacity, offset, reduceMotion]);

  return (
    <Animated.View style={[style, { opacity, transform: [{ translateX: offset }] }]}>
      {children}
    </Animated.View>
  );
}
