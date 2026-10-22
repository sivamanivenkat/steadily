import { Pressable, StyleSheet, View } from 'react-native';

import type { BudgetWithSpent } from '@/data/types';
import { spentRatio } from '@/lib/budget';
import { formatMoney, spokenMoney } from '@/lib/money';
import { layout, space, useTheme } from '@/theme';

import { AppText } from './AppText';
import { categoryMeta, CategoryTile } from './CategoryTile';
import { MiniPaceBar } from './MiniPaceBar';

const money = (cents: number) => formatMoney(cents, { cents: 'auto' });

/** "$87.60 left" / "Over by $12" for one budget. */
export function budgetStatus(row: BudgetWithSpent): {
  text: string;
  spoken: string;
  over: boolean;
} {
  const left = row.budget.amountMinor - row.spentMinor;
  return left >= 0
    ? { text: `${money(left)} left`, spoken: `${spokenMoney(left)} left`, over: false }
    : { text: `Over by ${money(-left)}`, spoken: `over by ${spokenMoney(-left)}`, over: true };
}

type BudgetRowProps = {
  row: BudgetWithSpent;
  monthRatio: number;
  now: Date;
  onPress: () => void;
  accessibilityHint?: string;
};

/** One category budget: tile, name, what's left, compact pace bar, "spent of budget". */
export function BudgetRow({
  row,
  monthRatio,
  now,
  onPress,
  accessibilityHint = 'Edit this budget',
}: BudgetRowProps) {
  const { colors } = useTheme();
  const categoryId = row.budget.categoryId;
  if (categoryId === null) return null;
  const name = categoryMeta(categoryId).name;
  const status = budgetStatus(row);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}: spent ${spokenMoney(row.spentMinor)} of ${spokenMoney(row.budget.amountMinor)}, ${status.spoken}`}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <CategoryTile categoryId={categoryId} />
      <View style={styles.body}>
        <View style={styles.top}>
          <AppText variant="bodyStrong" style={styles.flex}>
            {name}
          </AppText>
          <AppText
            variant="captionStrong"
            color={status.over ? colors.headsUp.text : colors.ink2}
            style={styles.tabular}
          >
            {status.text}
          </AppText>
        </View>
        <MiniPaceBar spentRatio={spentRatio(row, now)} monthRatio={monthRatio} />
        <AppText variant="caption" color={colors.ink2} style={styles.tabular}>
          {money(row.spentMinor)} of {money(row.budget.amountMinor)}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.7 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.touchTarget + layout.rowPaddingVertical,
    paddingVertical: layout.rowPaddingVertical + 2,
  },
  body: { flex: 1, gap: space.xs },
  top: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
});
