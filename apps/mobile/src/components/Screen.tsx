import { useEffect, useState, type ReactNode } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { layout, space } from '@/theme';

import { ScreenBackground } from './ScreenBackground';
import { useTabBarClearance } from './TabBar';

type ScreenProps = {
  children: ReactNode;
  /** Leave room for the floating tab bar. On for tab screens. */
  withTabBar?: boolean;
  /** 16 pt side padding instead of 20, for dense screens. */
  dense?: boolean;
  /** Caps the column at `layout.readableWidth`, centered, for text-heavy screens on wide displays. */
  readable?: boolean;
  /** Extra layout for the scroll content (merged last). */
  contentStyle?: StyleProp<ViewStyle>;
  /**
   * Pinned under the scrolling content and lifted above the keyboard, e.g. a form's Save button.
   * For stack screens (no tab bar).
   */
  footer?: ReactNode;
};

/** Whether the software keyboard is up (it covers the home indicator, so no inset is needed). */
function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () =>
      setVisible(true),
    );
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () =>
      setVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

/** The footer row: clear of the home indicator, or snug on the keyboard while it is up. */
function PinnedFooter({ side, children }: { side: number; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const keyboardUp = useKeyboardVisible();
  return (
    <View
      style={[
        styles.footer,
        {
          paddingLeft: insets.left + side,
          paddingRight: insets.right + side,
          paddingBottom: keyboardUp ? space.md : Math.max(insets.bottom, space.md) + space.sm,
        },
      ]}
    >
      {children}
    </View>
  );
}

/**
 * Scrolling screen on the Calm Glass background, clear of the notch and the tab bar. On tab
 * screens the bottom padding is the bar's measured height + its offset from the bottom (safe area
 * or inset) + a gap, so the last row always scrolls fully above the floating bar.
 */
export function Screen({
  children,
  withTabBar = true,
  dense = false,
  readable = false,
  contentStyle,
  footer,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const side = dense ? layout.screenPaddingDense : layout.screenPadding;
  const bottom = footer ? space.lg : withTabBar ? clearance : insets.bottom + space.xxl;

  const scroll = (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + space.md,
          paddingBottom: bottom,
          paddingLeft: insets.left + side,
          paddingRight: insets.right + side,
        },
        readable && styles.readable,
        contentStyle,
      ]}
      // Keep the scroll indicator out from under the floating bar too.
      scrollIndicatorInsets={
        withTabBar && !footer ? { bottom: clearance - insets.bottom } : undefined
      }
      contentInsetAdjustmentBehavior="never"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets={!footer}
    >
      {children}
    </ScrollView>
  );

  if (!footer) return <ScreenBackground>{scroll}</ScreenBackground>;

  return (
    <ScreenBackground>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {scroll}
        <PinnedFooter side={side}>{footer}</PinnedFooter>
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    gap: layout.cardGap,
  },
  footer: { paddingTop: space.sm, gap: space.sm },
  readable: { width: '100%', maxWidth: layout.readableWidth, alignSelf: 'center' },
});
