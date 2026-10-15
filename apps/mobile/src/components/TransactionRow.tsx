import { getBuiltInCategory, isBuiltInCategoryId, type CategoryId } from '@steadily/taxonomy';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatMoney, spokenMoney } from '@/lib/money';
import { categoryColors, iconSize, layout, radius, space, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export type TransactionBadge = { kind: 'priceUp' | 'review'; label: string };

type TransactionRowProps = {
  merchant: string;
  amountCents: number;
  categoryId: CategoryId;
  /** Display name for custom categories; built-ins use the taxonomy name. */
  categoryName?: string;
  /** e.g. "8:14 AM", "Yesterday" */
  timeLabel: string;
  badge?: TransactionBadge;
  onPress?: () => void;
};

const TILE_SIZE = 40;

function categoryMeta(id: CategoryId, fallbackName?: string): { name: string; icon: IconName } {
  if (isBuiltInCategoryId(id)) {
    const category = getBuiltInCategory(id);
    return { name: category.name, icon: category.icon };
  }
  return { name: fallbackName ?? 'Custom', icon: 'dots' };
}

export function TransactionRow({
  merchant,
  amountCents,
  categoryId,
  categoryName,
  timeLabel,
  badge,
  onPress,
}: TransactionRowProps) {
  const { colors, scheme } = useTheme();
  const category = categoryMeta(categoryId, categoryName);
  const tile = categoryColors(categoryId, scheme);

  const label = [merchant, spokenMoney(amountCents), category.name, timeLabel, badge?.label]
    .filter(Boolean)
    .join(', ');

  const content = (
    <>
      <View style={[styles.tile, { backgroundColor: tile.fill }]}>
        <Icon name={category.icon} size={iconSize.md} color={tile.ink} />
      </View>
      <View style={styles.text}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {merchant}
        </AppText>
        <AppText variant="caption" color={colors.ink2}>
          {category.name} · {timeLabel}
        </AppText>
        {badge ? (
          <View style={[styles.badge, { backgroundColor: colors.headsUp.bg }]}>
            <Icon
              name={badge.kind === 'priceUp' ? 'arrowUp' : 'inbox'}
              size={12}
              color={colors.headsUp.text}
              strokeWidth={2.4}
            />
            <AppText variant="captionStrong" color={colors.headsUp.text}>
              {badge.label}
            </AppText>
          </View>
        ) : null}
      </View>
      <AppText variant="amount" style={styles.amount}>
        {formatMoney(amountCents)}
      </AppText>
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        {content}
      </Pressable>
    );
  }
  return (
    <View style={styles.row} accessible accessibilityLabel={label}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.touchTarget + layout.rowPaddingVertical,
    paddingVertical: layout.rowPaddingVertical,
  },
  pressed: { opacity: 0.7 },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: radius.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    flexShrink: 1,
    gap: 2,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    marginTop: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  amount: {
    flexShrink: 0,
    textAlign: 'right',
  },
});
