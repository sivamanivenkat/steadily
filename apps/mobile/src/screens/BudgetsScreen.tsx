import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  AppText,
  BudgetRow,
  Card,
  EmptyState,
  Icon,
  IconTile,
  ListCard,
  ListRow,
  OnDeviceBadge,
  PaceBar,
  Screen,
  ScreenHeader,
  SectionLabel,
  SkeletonHero,
  Touchable,
} from '@/components';
import { useData, useNow } from '@/data';
import { categoryBudgets, monthProgress, overallBudget, safeToSpend } from '@/lib/budget';
import { formatMonth, formatShortDate, monthRange } from '@/lib/dates';
import { formatMoney, spokenMoney } from '@/lib/money';
import { iconSize, layout, space, useTheme } from '@/theme';

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
      <ScreenHeader eyebrow={formatMonth(now)} title="Budgets" />

      {rows === undefined || subscriptions === undefined ? (
        <SkeletonHero label="Loading budgets" />
      ) : overall ? (
        (() => {
          const safe = safeToSpend(
            overall,
            subscriptions.map((s) => s.subscription),
            now,
          );
          return (
            <Card tier="hero" contentStyle={styles.overall}>
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
                tabular
                accessibilityLabel={`Spent ${spokenMoney(overall.spentMinor)} of ${spokenMoney(overall.budget.amountMinor)}. About ${spokenMoney(safe.perDayMinor)} a day until ${formatShortDate(endOfMonth)}.`}
              >
                {money(overall.spentMinor)} of {money(overall.budget.amountMinor)} spent · about{' '}
                {money(safe.perDayMinor)} a day until {formatShortDate(endOfMonth)}
              </AppText>
              <PaceBar spentRatio={safe.spentRatio} monthRatio={monthRatio} />
              <Touchable
                onPress={() => edit(null)}
                accessibilityRole="button"
                accessibilityLabel="Edit monthly budget"
                accessibilityHint={`Currently ${spokenMoney(overall.budget.amountMinor)} a month`}
                style={[styles.heroFooter, { borderTopColor: colors.hairline }]}
              >
                <View style={styles.flex}>
                  <AppText variant="caption" color={colors.ink2}>
                    Monthly budget
                  </AppText>
                  <AppText variant="bodyStrong" tabular>
                    {money(overall.budget.amountMinor)}
                  </AppText>
                </View>
                <AppText variant="captionStrong" color={colors.accentInk}>
                  Edit
                </AppText>
                <Icon name="chevronRight" size={iconSize.sm} color={colors.accentInk} />
              </Touchable>
            </Card>
          );
        })()
      ) : (
        <EmptyState
          tier="hero"
          icon="budgets"
          title="Set a monthly budget"
          body="One number for the month. We'll show what's safe to spend each day."
          action={{ label: 'Set monthly budget', onPress: () => edit(null) }}
        />
      )}

      {rows === undefined ? null : categories.length > 0 ? (
        <>
          <SectionLabel
            action={{
              label: 'Add',
              accessibilityLabel: 'Set a budget',
              accessibilityHint: 'Adds a budget for one category',
              onPress: () => edit(),
            }}
          >
            Categories
          </SectionLabel>
          <ListCard>
            {categories.map((row) => (
              <BudgetRow
                key={row.budget.id}
                row={row}
                monthRatio={monthRatio}
                now={now}
                onPress={() => edit(row.budget.categoryId)}
              />
            ))}
          </ListCard>
        </>
      ) : (
        <>
          <SectionLabel>Categories</SectionLabel>
          <EmptyState
            icon="plus"
            tone="neutral"
            title="No category budgets yet"
            body="Give a category like Dining Out its own limit and track its pace here."
            action={{
              label: 'Add a category budget',
              variant: overall ? 'primary' : 'secondary',
              onPress: () => edit(),
            }}
          />
        </>
      )}

      <SectionLabel>Insights</SectionLabel>
      <ListCard>
        <ListRow
          title="Spending trends"
          subtitle="This month against last month and your average"
          leading={<IconTile icon="chart" tone="accent" />}
          chevron
          accessibilityHint="Opens spending trends"
          onPress={() => router.push('/trends')}
        />
      </ListCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  overall: { gap: space.sm },
  overallHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  heroFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: layout.touchTarget,
    marginTop: space.xs,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
  },
});
