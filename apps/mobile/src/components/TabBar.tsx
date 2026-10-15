import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, View } from 'react-native';

import { iconSize, layout, space, tabBar, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Glass } from './Glass';
import { Icon, type IconName } from './Icon';

/** Icon per tab route name. Unknown routes fall back to the dots icon. */
const TAB_ICONS: Record<string, IconName> = {
  index: 'home',
  activity: 'activity',
  budgets: 'budgets',
  ask: 'ask',
};

/** Space screens must leave at the bottom so content can scroll clear of the floating bar. */
export function tabBarClearance(bottomInset: number): number {
  return tabBar.height + Math.max(bottomInset, tabBar.inset) + space.lg;
}

/** Floating glass pill tab bar (steadily-ui "TabBar"). */
export function TabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const { colors } = useTheme();

  return (
    <View
      pointerEvents="box-none"
      style={[styles.container, { bottom: Math.max(insets.bottom, tabBar.inset) }]}
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
              <Pressable
                key={route.key}
                onPress={onPress}
                onLongPress={onLongPress}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={options?.tabBarAccessibilityLabel ?? label}
                testID={options?.tabBarButtonTestID}
                style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
              >
                <Icon name={TAB_ICONS[route.name] ?? 'dots'} size={iconSize.lg} color={tint} />
                <AppText variant={focused ? 'tabActive' : 'tab'} color={tint} numberOfLines={1}>
                  {label}
                </AppText>
              </Pressable>
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
  pressed: { opacity: 0.7 },
});
