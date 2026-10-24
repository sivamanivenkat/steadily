import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReduceMotion } from '@/hooks/useAccessibilitySettings';
import { iconSize, layout, radius, space, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Button } from './Button';
import { Glass } from './Glass';
import { Icon } from './Icon';

export type ToastAction = {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
};

type ToastProps = {
  /** What happened. `null` hides the toast at once. */
  message: string | null;
  /** One follow-up, usually "Undo". */
  action?: ToastAction;
  /** Called when the toast times out. Not called while a screen reader is on (no timed content). */
  onHide: () => void;
  /** How long it stays before hiding itself. */
  durationMs?: number;
};

/** Rise distance on appear (steadily-ui "Motion": toast rises 16 px + fades in). */
const RISE = 16;
const APPEAR_MS = 220;
const HIDE_MS = 160;
const DEFAULT_DURATION_MS = 6000;

/**
 * Confirmation toast pinned near the bottom of the screen, above the home indicator: strong glass,
 * a check, one line of text and an optional action. Render it as a sibling after `Screen` so it
 * floats over the scroll content. With Reduce Motion it only fades.
 */
export function Toast({ message, action, onHide, durationMs = DEFAULT_DURATION_MS }: ToastProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const onHideRef = useRef(onHide);
  onHideRef.current = onHide;

  useEffect(() => {
    if (message === null) {
      progress.setValue(0);
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    Animated.timing(progress, {
      toValue: 1,
      duration: APPEAR_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    void AccessibilityInfo.isScreenReaderEnabled().then((screenReader) => {
      if (!active || screenReader) return;
      timer = setTimeout(() => {
        Animated.timing(progress, {
          toValue: 0,
          duration: HIDE_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished && active) onHideRef.current();
        });
      }, durationMs);
    });
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [message, durationMs, progress]);

  if (message === null) return null;

  const translateY = reduceMotion
    ? 0
    : progress.interpolate({ inputRange: [0, 1], outputRange: [RISE, 0] });

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.layer,
        {
          bottom: Math.max(insets.bottom, space.lg) + space.md,
          left: insets.left + layout.screenPadding,
          right: insets.right + layout.screenPadding,
          opacity: progress,
          transform: [{ translateY }],
        },
      ]}
    >
      <Glass variant="strong" radius={radius.toast} fixed contentStyle={styles.toast}>
        <View style={[styles.check, { backgroundColor: colors.status.onTrack.bg }]}>
          <Icon name="check" size={iconSize.sm} color={colors.status.onTrack.text} />
        </View>
        <AppText
          variant="body"
          style={styles.text}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {message}
        </AppText>
        {action ? (
          <Button
            label={action.label}
            variant="accentTint"
            accessibilityLabel={action.accessibilityLabel}
            onPress={action.onPress}
          />
        ) : null}
      </Glass>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute' },
  toast: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.md,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    paddingVertical: space.sm,
  },
  check: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, minWidth: 160 },
});
