import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  AppText,
  Button,
  CategoryTile,
  Glass,
  MiniPaceBar,
  OnDeviceBadge,
  PaceBar,
  Screen,
  SectionLabel,
} from '@/components';
import { categoryMeta } from '@/components/CategoryTile';
import { useData, useNow } from '@/data';
import type { BudgetWithSpent } from '@/data/types';
import { categoryBudgets, monthProgress, overallBudget, safeToSpend } from '@/lib/budget';
import { formatMonth, formatShortDate, monthRange } from '@/lib/dates';
import { formatMoney, spokenMoney } from '@/lib/money';
import { layout, radius, space, useTheme } from '@/theme';

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

function BudgetRow({
  row,
  monthRatio,
  onPress,
}: {
  row: BudgetWithSpent;
  monthRatio: number;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const categoryId = row.budget.categoryId;
  if (categoryId === null) return null;
  const name = categoryMeta(categoryId).name;
  const status = budgetStatus(row);
  const ratio = row.budget.amountMinor > 0 ? row.spentMinor / row.budget.amountMinor : 0;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}: spent ${spokenMoney(row.spentMinor)} of ${spokenMoney(row.budget.amountMinor)}, ${status.spoken}`}
      accessibilityHint="Edit this budget"
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <CategoryTile categoryId={categoryId} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
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
        <MiniPaceBar spentRatio={ratio} monthRatio={monthRatio} />
        <AppText variant="caption" color={colors.ink2} style={styles.tabular}>
          {money(row.spentMinor)} of {money(row.budget.amountMinor)}
        </AppText>
      </View>
    </Pressable>
  );
}

/** Budgets tab: overall pace and safe-to-spend, then per-category budgets. */
export function BudgetsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const now = useNow();
  const { data: rows } = useData((source) => source.listBudgets(monthRange(now)), [now]);

  const overall = rows ? overallBudget(rows) : null;
  const categories = rows ? categoryBudgets(rows) : [];
  const monthRatio = monthProgress(now);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  /** Opens the budget editor for a category, the overall budget, or (undefined) a new one. */
  const edit = (categoryId?: string | null) =>
    router.push({
      pathname: '/budget-edit',
      params: categoryId === undefined ? {} : { categoryId: categoryId ?? 'overall' },
    });

  return (
    <Screen>
      <View>
        <AppText variant="caption" color={colors.ink2}>
          {formatMonth(now)}
        </AppText>
        <AppText variant="title" accessibilityRole="header">
          Budgets
        </AppText>
      </View>

      {rows === undefined ? null : overall ? (
        (() => {
          const safe = safeToSpend(overall.budget.amountMinor, overall.spentMinor, now);
          return (
            <Glass variant="strong" radius={radius.card} contentStyle={styles.overall}>
              <View style={styles.overallHeader}>
                <AppText variant="heading" color={colors.ink2}>
                  Safe to spend
                </AppText>
                <OnDeviceBadge />
              </View>
              <AppText
                variant="amountL"
                accessibilityLabel={`Safe to spend: ${spokenMoney(safe.amountMinor)}`}
              >
                {money(safe.amountMinor)}
              </AppText>
              <AppText
                variant="caption"
                color={colors.ink2}
                accessibilityLabel={`Spent ${spokenMoney(overall.spentMinor)} of ${spokenMoney(overall.budget.amountMinor)}. About ${spokenMoney(safe.perDayMinor)} a day until ${formatShortDate(endOfMonth)}.`}
              >
                {money(overall.spentMinor)} of {money(overall.budget.amountMinor)} spent · about{' '}
                {money(safe.perDayMinor)} a day until {formatShortDate(endOfMonth)}
              </AppText>
              <PaceBar spentRatio={safe.spentRatio} monthRatio={monthRatio} />
              <Button
                label="Edit monthly budget"
                variant="link"
                onPress={() => edit(null)}
                style={styles.alignStart}
              />
            </Glass>
          );
        })()
      ) : (
        <Glass variant="strong" radius={radius.card} contentStyle={styles.overall}>
          <AppText variant="heading">Set a monthly budget</AppText>
          <AppText variant="body" color={colors.ink2}>
            One number for the month. We'll show what's safe to spend each day.
          </AppText>
          <Button label="Set monthly budget" onPress={() => edit(null)} />
        </Glass>
      )}

      <SectionLabel>Categories</SectionLabel>
      {categories.length > 0 ? (
        <Glass variant="light" radius={radius.cardSmall} contentStyle={styles.list}>
          {categories.map((row, i) => (
            <View
              key={row.budget.id}
              style={i > 0 && [styles.divider, { borderTopColor: colors.hairline }]}
            >
              <BudgetRow
                row={row}
                monthRatio={monthRatio}
                onPress={() => edit(row.budget.categoryId)}
              />
            </View>
          ))}
        </Glass>
      ) : rows !== undefined ? (
        <AppText variant="body" color={colors.ink2}>
          No category budgets yet.
        </AppText>
      ) : null}

      <Button label="Set a budget" icon="plus" onPress={() => edit()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.7 },
  alignStart: { alignSelf: 'flex-start', marginLeft: -space.lg },
  overall: { padding: layout.cardPadding + 2, gap: space.sm },
  overallHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  list: { paddingHorizontal: space.lg, paddingVertical: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.touchTarget + layout.rowPaddingVertical,
    paddingVertical: layout.rowPaddingVertical + 2,
  },
  rowBody: { flex: 1, gap: space.xs },
  rowTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  divider: { borderTopWidth: StyleSheet.hairlineWidth * 2 },
});
