import { useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useReduceMotion } from '@/hooks/useAccessibilitySettings';
import { motion } from '@/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type PressFeedback = 'scale' | 'opacity' | 'none';

export type TouchableProps = Omit<PressableProps, 'style'> & {
  /**
   * `scale` (cards, buttons, chips): dims and shrinks slightly. `opacity` (rows inside a list,
   * tabs, links): dims only, so rows never shift against their neighbours. With Reduce Motion
   * `scale` falls back to `opacity`.
   */
  feedback?: PressFeedback;
  style?: StyleProp<ViewStyle>;
};

/**
 * The one pressable surface. Gives every tappable thing the same quick press response (no
 * haptics), animated on the native thread. Transform and opacity never change layout bounds.
 */
export function Touchable({
  feedback = 'opacity',
  style,
  disabled,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: TouchableProps) {
  const reduceMotion = useReduceMotion();
  const pressed = useRef(new Animated.Value(0)).current;

  const animate = (toValue: 0 | 1) => {
    Animated.timing(pressed, {
      toValue,
      duration: toValue === 1 ? motion.pressInMs : motion.pressOutMs,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  const handlePressIn = (event: GestureResponderEvent) => {
    if (feedback !== 'none') animate(1);
    onPressIn?.(event);
  };
  const handlePressOut = (event: GestureResponderEvent) => {
    if (feedback !== 'none') animate(0);
    onPressOut?.(event);
  };

  // Disabled surfaces keep their own (dimmed) opacity.
  const animatedStyle =
    feedback === 'none' || disabled
      ? null
      : {
          opacity: pressed.interpolate({
            inputRange: [0, 1],
            outputRange: [1, motion.pressedOpacity],
          }),
          ...(feedback === 'scale' && !reduceMotion
            ? {
                transform: [
                  {
                    scale: pressed.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, motion.pressedScale],
                    }),
                  },
                ],
              }
            : {}),
        };

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
