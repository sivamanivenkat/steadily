import type { ReactNode } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReduceMotion } from '@/hooks/useAccessibilitySettings';
import { cardTier, layout, radius, space, useTheme } from '@/theme';

import { Glass } from './Glass';

type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Spoken name of the dimmed backdrop, which also closes the sheet. */
  dismissLabel?: string;
  /** Tallest the sheet may grow; content inside should scroll past it. */
  maxHeight?: DimensionValue;
  /** Layout for the sheet body (merged over the default padding). */
  contentStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
};

const GRABBER = { width: 36, height: 5 } as const;

/**
 * Bottom sheet on strong glass over a scrim. Slides up (fades with Reduce Motion); tapping the
 * scrim or the system back closes it. The body clears the home indicator.
 */
export function BottomSheet({
  visible,
  onClose,
  dismissLabel = 'Dismiss',
  maxHeight = '85%',
  contentStyle,
  children,
}: BottomSheetProps) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'fade' : 'slide'}
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.root}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={dismissLabel}
        />
        <Glass
          variant="strong"
          radius={cardTier.hero.radius}
          style={[styles.sheet, { maxHeight }]}
          contentStyle={[styles.content, { paddingBottom: insets.bottom + space.lg }, contentStyle]}
        >
          <View
            style={[styles.grabber, { backgroundColor: colors.track }]}
            accessible={false}
            importantForAccessibility="no"
          />
          {children}
        </Glass>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  content: {
    flexShrink: 1,
    gap: space.md,
    paddingTop: space.sm,
    paddingHorizontal: layout.screenPadding,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  grabber: {
    alignSelf: 'center',
    width: GRABBER.width,
    height: GRABBER.height,
    borderRadius: radius.pill,
    marginBottom: space.xs,
  },
});
