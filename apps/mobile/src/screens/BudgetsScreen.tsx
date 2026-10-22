import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  AppText,
  BudgetRow,
  Button,
  Glass,
  OnDeviceBadge,
  PaceBar,
  Screen,
  SectionLabel,
} from '@/components';
import { useData, useNow } from '@/data';
import { categoryBudgets, monthProgress, overallBudget, safeToSpend } from '@/lib/budget';
import { formatMonth, formatShortDate, monthRange } from '@/lib/dates';
import { formatMoney, spokenMoney } from '@/lib/money';
import { layout, radius, space, useTheme } from '@/theme';

const money = (cents: number) => formatMoney(cents, { cents: 'auto' });

/** Budgets tab: overall pace and safe-to-spend, then per-category budgets. */
export function BudgetsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const now = useNow();
  const { data: rows } = useData((source) => source.listBudgets(monthRange(now)), [now]);
  const { data: subscriptions } = useData((source) => source.listSubscriptions());

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

      {rows === undefined || subscriptions === undefined ? null : overall ? (
        (() => {
          const safe = safeToSpend(
            overall,
            subscriptions.map((s) => s.subscription),
            now,
          );
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

      <Button
        label="See spending trends"
        icon="chart"
        variant="secondary"
        accessibilityHint="Compares this month with past months"
        onPress={() => router.push('/trends')}
      />

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
                now={now}
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
  divider: { borderTopWidth: StyleSheet.hairlineWidth * 2 },
});
