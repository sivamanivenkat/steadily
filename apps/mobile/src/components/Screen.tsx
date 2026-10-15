import type { ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { layout, space } from '@/theme';

import { ScreenBackground } from './ScreenBackground';
import { tabBarClearance } from './TabBar';

type ScreenProps = {
  children: ReactNode;
  /** Leave room for the floating tab bar. On for tab screens. */
  withTabBar?: boolean;
};

/** Scrolling screen on the Calm Glass background, clear of the notch and the tab bar. */
export function Screen({ children, withTabBar = true }: ScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <ScreenBackground>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + space.md,
            paddingBottom: withTabBar ? tabBarClearance(insets.bottom) : insets.bottom + space.xxl,
            paddingLeft: insets.left + layout.screenPadding,
            paddingRight: insets.right + layout.screenPadding,
          },
        ]}
        contentInsetAdjustmentBehavior="never"
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
