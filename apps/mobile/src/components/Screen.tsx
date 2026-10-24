import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
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
  /** Extra layout for the scroll content (merged last). */
  contentStyle?: StyleProp<ViewStyle>;
};

/**
 * Scrolling screen on the Calm Glass background, clear of the notch and the tab bar. On tab
 * screens the bottom padding is the bar's measured height + its offset from the bottom (safe area
 * or inset) + a gap, so the last row always scrolls fully above the floating bar.
 */
export function Screen({ children, withTabBar = true, dense = false, contentStyle }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const side = dense ? layout.screenPaddingDense : layout.screenPadding;
  const bottom = withTabBar ? clearance : insets.bottom + space.xxl;
  return (
    <ScreenBackground>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + space.md,
            paddingBottom: bottom,
            paddingLeft: insets.left + side,
            paddingRight: insets.right + side,
          },
          contentStyle,
        ]}
        // Keep the scroll indicator out from under the floating bar too.
        scrollIndicatorInsets={withTabBar ? { bottom: clearance - insets.bottom } : undefined}
        contentInsetAdjustmentBehavior="never"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
      >
        {children}
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: layout.cardGap,
  },
});
