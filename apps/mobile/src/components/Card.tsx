import { Children, isValidElement, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { cardTier, layout, space, useTheme, type CardTier } from '@/theme';

import { Glass } from './Glass';

type CardProps = {
  /** Importance level; see `cardTier` in the theme. */
  tier?: Exclude<CardTier, 'list'>;
  /** Outer layout (margins, flex). */
  style?: StyleProp<ViewStyle>;
  /** Inner layout, merged over the tier's padding and gap. */
  contentStyle?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

/**
 * A card at one of three tiers. `hero` is for the key number on a screen (strong glass, raised);
 * `standard` for secondary content (light glass, soft shadow); `inset` for a quiet surface inside
 * another card (flat).
 */
export function Card({ tier = 'standard', style, contentStyle, children }: CardProps) {
  const shape = cardTier[tier];
  return (
    <Glass
      variant={tier === 'hero' ? 'strong' : 'light'}
      elevation={tier === 'hero' ? 'raised' : tier === 'inset' ? 'none' : 'soft'}
      radius={shape.radius}
      style={style}
      contentStyle={[{ padding: shape.padding }, styles.content, contentStyle]}
    >
      {children}
    </Glass>
  );
}

type ListCardProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Strong glass for lists that carry key amounts in a sheet or on their own. */
  strong?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: 'list' | 'radiogroup';
};

/**
 * A card of rows separated by hairlines. Pass rows as children; `null`/`false` children are
 * skipped, so conditional rows need no divider bookkeeping.
 */
export function ListCard({
  children,
  style,
  strong = false,
  accessibilityLabel,
  accessibilityRole,
}: ListCardProps) {
  const { colors } = useTheme();
  // `toArray` drops null, undefined and booleans, so conditional rows need no bookkeeping.
  const rows = Children.toArray(children);
  return (
    <Glass
      variant={strong ? 'strong' : 'light'}
      elevation="soft"
      radius={cardTier.list.radius}
      style={style}
      contentStyle={styles.list}
    >
      <View accessibilityRole={accessibilityRole} accessibilityLabel={accessibilityLabel}>
        {rows.map((row, i) => (
          <View
            key={isValidElement(row) && row.key !== null ? row.key : i}
            style={i > 0 && [styles.divider, { borderTopColor: colors.hairline }]}
          >
            {row}
          </View>
        ))}
      </View>
    </Glass>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md },
  list: {
    paddingHorizontal: layout.listPaddingHorizontal,
    paddingVertical: layout.listPaddingVertical,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth * 2 },
});
