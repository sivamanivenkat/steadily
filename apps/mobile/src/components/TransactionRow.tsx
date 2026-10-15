import type { CategoryId } from '@steadily/taxonomy';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatMoney, spokenMoney } from '@/lib/money';
import { layout, radius, space, useTheme } from '@/theme';

import { AppText } from './AppText';
import { CategoryTile, categoryMeta } from './CategoryTile';
import { Icon } from './Icon';

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
  /** Replaces the category name in the caption, e.g. "Income", "Not an expense". */
  kindLabel?: string;
  /** Money coming in: shown with a plus sign. */
  incoming?: boolean;
  onPress?: () => void;
};

export function TransactionRow({
  merchant,
  amountCents,
  categoryId,
  categoryName,
  timeLabel,
  badge,
  kindLabel,
  incoming = false,
  onPress,
}: TransactionRowProps) {
  const { colors } = useTheme();
  const category = categoryMeta(categoryId, categoryName);
  const caption = kindLabel ?? category.name;
  const spoken = incoming ? `plus ${spokenMoney(amountCents)}` : spokenMoney(amountCents);

  const label = [merchant, spoken, caption, timeLabel, badge?.label].filter(Boolean).join(', ');

  const content = (
    <>
      <CategoryTile categoryId={categoryId} icon={category.icon} />
      <View style={styles.text}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {merchant}
        </AppText>
        <AppText variant="caption" color={colors.ink2}>
          {caption} · {timeLabel}
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
        {`${incoming ? '+' : ''}${formatMoney(amountCents)}`}
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
