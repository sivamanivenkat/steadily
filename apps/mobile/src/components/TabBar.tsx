import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useSyncExternalStore } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { iconSize, layout, radius, space, tabBar, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Glass } from './Glass';
import { Icon, type IconName } from './Icon';
import { Touchable } from './Touchable';

/** Icon per tab route name. Unknown routes fall back to the dots icon. */
const TAB_ICONS: Record<string, IconName> = {
  index: 'home',
  activity: 'activity',
  budgets: 'budgets',
  ask: 'ask',
};

/** Distance from the screen bottom to the bar: the safe area, but never tighter than the inset. */
export function tabBarBottom(bottomInset: number): number {
  return Math.max(bottomInset, tabBar.inset);
}

/**
 * Space screens must leave at the bottom so their last row scrolls fully clear of the floating
 * bar: the bar's offset from the bottom, its height, and a gap.
 */
export function tabBarClearance(bottomInset: number, barHeight: number = tabBar.height): number {
  return tabBarBottom(bottomInset) + barHeight + tabBar.contentGap;
}

// The bar's measured height. It can grow past the 68 pt spec (large text), and screens must clear
// the real bar, so the bar reports its height here and screens read it.
let measuredHeight: number = tabBar.height;
const listeners = new Set<() => void>();

function setMeasuredHeight(height: number) {
  if (Math.abs(height - measuredHeight) < 0.5) return;
  measuredHeight = height;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getMeasuredHeight = () => measuredHeight;

/** Bottom padding for a scrolling tab screen, from the live bar height and the safe area. */
export function useTabBarClearance(): number {
  const insets = useSafeAreaInsets();
  const height = useSyncExternalStore(subscribe, getMeasuredHeight, getMeasuredHeight);
  return tabBarClearance(insets.bottom, height);
}

/** Floating glass pill tab bar (steadily-ui "TabBar"). */
export function TabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const { colors } = useTheme();

  return (
    <View
      pointerEvents="box-none"
      style={[styles.container, { bottom: tabBarBottom(insets.bottom) }]}
      onLayout={(event: LayoutChangeEvent) => setMeasuredHeight(event.nativeEvent.layout.height)}
    >
      <Glass variant="strong" radius={tabBar.radius} fixed contentStyle={styles.bar}>
        <View style={styles.row} accessibilityRole="tablist">
          {state.routes.map((route, index) => {
            const descriptor = descriptors[route.key];
            const options = descriptor?.options;
            const label =
              typeof options?.tabBarLabel === 'string'
                ? options.tabBarLabel
                : (options?.title ?? route.name);
            const focused = index === state.index;
            const tint = focused ? colors.accent : colors.ink2;

            const onPress = () => {
              const event = emitter.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) navigateToTab(route.key);
            };
            const onLongPress = () => {
              emitter.emit({ type: 'tabLongPress', target: route.key });
            };

            return (
              <Touchable
                key={route.key}
                onPress={onPress}
                onLongPress={onLongPress}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={options?.tabBarAccessibilityLabel ?? label}
                testID={options?.tabBarButtonTestID}
                style={styles.tab}
              >
                {/* The active tab gets a tinted pill as well as color and weight. */}
                <View style={[styles.iconPill, focused && { backgroundColor: colors.accentTint }]}>
                  <Icon name={TAB_ICONS[route.name] ?? 'dots'} size={iconSize.lg} color={tint} />
                </View>
                <AppText variant={focused ? 'tabActive' : 'tab'} color={tint} numberOfLines={1}>
                  {label}
                </AppText>
              </Touchable>
            );
          })}
        </View>
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: tabBar.inset,
    right: tabBar.inset,
  },
  bar: {
    minHeight: tabBar.height,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tab: {
    flex: 1,
    minHeight: layout.touchTarget + space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: space.xs,
  },
  iconPill: {
    width: 52,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
