import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  AppText,
  BudgetRow,
  Button,
  Glass,
  Icon,
  IconButton,
  PaceBar,
  SafeToSpendCard,
  Screen,
  SectionLabel,
  TransactionRow,
  type TransactionBadge,
} from '@/components';
import { useData, useNow } from '@/data';
import type { SubscriptionSummary, Transaction } from '@/data/types';
import { busiestCategoryBudgets, monthlyTotal, monthProgress, safeToSpendFor } from '@/lib/budget';
import {
  formatLongDate,
  formatShortDate,
  monthRange,
  recentRange,
  relativeTimeLabel,
} from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { iconSize, layout, radius, space, useTheme } from '@/theme';

const RECENT_COUNT = 4;
const BUDGET_COUNT = 3;
const CATEGORY_BASIS_LABEL = 'Based on your category budgets';

function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** "Price up $2.50" on the latest charge of a subscription whose price went up. */
function badgeFor(
  tx: Transaction,
  subscriptions: readonly SubscriptionSummary[],
): TransactionBadge | undefined {
  if (tx.status === 'needs_review') return { kind: 'review', label: 'Needs review' };
  const match = subscriptions.find(
    (s) =>
      s.subscription.merchantName === tx.merchantName &&
      s.subscription.lastChargedAt.slice(0, 10) <= tx.occurredAt.slice(0, 10) &&
      s.previousAmountMinor !== null &&
      s.subscription.amountMinor > s.previousAmountMinor,
  );
  if (!match || match.previousAmountMinor === null) return undefined;
  const increase = match.subscription.amountMinor - match.previousAmountMinor;
  return { kind: 'priceUp', label: `Price up ${formatMoney(increase, { cents: 'auto' })}` };
}

export function HomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const now = useNow();

  const { data: budgets } = useData((s) => s.listBudgets(monthRange(now)), [now]);
  const { data: review } = useData((s) => s.listNeedsReview());
  const { data: recent } = useData((s) => s.listTransactions(recentRange(now)), [now]);
  const { data: subscriptions } = useData((s) => s.listSubscriptions());

  // The overall budget, or the category budgets added up when there is no overall one.
  const monthly = budgets ? monthlyTotal(budgets) : null;
  const safe =
    monthly && subscriptions
      ? safeToSpendFor(
          monthly,
          subscriptions.map((s) => s.subscription),
          now,
        )
      : null;
  const monthRatio = monthProgress(now);
  const busiest = budgets ? busiestCategoryBudgets(budgets, now, BUDGET_COUNT) : [];
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const toReview = review?.length ?? 0;
  const recentRows = (recent ?? []).slice(0, RECENT_COUNT);

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <AppText variant="caption" color={colors.ink2}>
            {formatLongDate(now)}
          </AppText>
          <AppText variant="title" accessibilityRole="header">
            {greetingFor(now)}
          </AppText>
        </View>
        <IconButton
          icon="settings"
          accessibilityLabel="Settings"
          onPress={() => router.push('/settings')}
        />
      </View>

      {budgets === undefined || subscriptions === undefined ? null : safe && monthly ? (
        <>
          <SafeToSpendCard
            amountCents={safe.amountMinor}
            untilLabel={formatShortDate(endOfMonth)}
            perDayCents={safe.perDayMinor}
            {...(monthly.basis === 'categories' ? { basisLabel: CATEGORY_BASIS_LABEL } : {})}
          />
          <Glass variant="light" radius={radius.cardSmall} contentStyle={styles.card}>
            <AppText variant="heading">
              {monthly.basis === 'categories' ? 'Budgeted categories this month' : 'This month'}
            </AppText>
            <PaceBar spentRatio={safe.spentRatio} monthRatio={monthRatio} />
          </Glass>
        </>
      ) : (
        <Glass variant="strong" radius={radius.card} contentStyle={styles.card}>
          <AppText variant="heading">See what's safe to spend</AppText>
          <AppText variant="body" color={colors.ink2}>
            Set a monthly budget and Steadily keeps the daily number for you.
          </AppText>
          <Button label="Set a budget" onPress={() => router.navigate('/budgets')} />
        </Glass>
      )}

      {toReview > 0 ? (
        <Pressable
          onPress={() => router.push('/review')}
          accessibilityRole="button"
          accessibilityLabel={`${toReview} transactions to review`}
          accessibilityHint="Opens the review queue"
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Glass variant="light" radius={radius.row} contentStyle={styles.reviewRow}>
            <View style={[styles.reviewIcon, { backgroundColor: colors.headsUp.bg }]}>
              <Icon name="inbox" size={iconSize.md} color={colors.headsUp.text} />
            </View>
            <View style={styles.reviewText}>
              <AppText variant="bodyStrong">{toReview} to review</AppText>
              <AppText variant="caption" color={colors.ink2}>
                Confirm categories in a tap
              </AppText>
            </View>
            <Icon name="chevronRight" size={iconSize.md} color={colors.ink2} />
          </Glass>
        </Pressable>
      ) : null}

      {busiest.length > 0 ? (
        <>
          <View style={styles.sectionRow}>
            <View style={styles.flex}>
              <SectionLabel>Budgets</SectionLabel>
            </View>
            <Button
              label="See all"
              variant="link"
              accessibilityLabel="See all budgets"
              onPress={() => router.navigate('/budgets')}
              style={styles.edgeRight}
            />
          </View>
          <Glass variant="light" radius={radius.cardSmall} contentStyle={styles.list}>
            {busiest.map((row, i) => (
              <View
                key={row.budget.id}
                style={i > 0 && [styles.divider, { borderTopColor: colors.hairline }]}
              >
                <BudgetRow
                  row={row}
                  monthRatio={monthRatio}
                  now={now}
                  onPress={() =>
                    router.push({
                      pathname: '/budget-edit',
                      params: { categoryId: row.budget.categoryId ?? 'overall' },
                    })
                  }
                />
              </View>
            ))}
          </Glass>
        </>
      ) : null}

      {recentRows.length > 0 ? (
        <>
          <SectionLabel>Recent</SectionLabel>
          <Glass variant="light" radius={radius.cardSmall} contentStyle={styles.list}>
            {recentRows.map((tx, i) => {
              const badge = badgeFor(tx, subscriptions ?? []);
              return (
                <View
                  key={tx.id}
                  style={i > 0 && [styles.divider, { borderTopColor: colors.hairline }]}
                >
                  <TransactionRow
                    merchant={tx.merchantName ?? tx.merchantRaw ?? 'Unknown merchant'}
                    amountCents={tx.amountMinor}
                    categoryId={tx.categoryId}
                    timeLabel={relativeTimeLabel(new Date(tx.occurredAt), now)}
                    {...(badge ? { badge } : {})}
                    {...(tx.kind === 'income' ? { kindLabel: 'Income', incoming: true } : {})}
                    {...(tx.kind === 'transfer' ? { kindLabel: 'Not an expense' } : {})}
                    onPress={() =>
                      router.push({ pathname: '/transaction/[id]', params: { id: tx.id } })
                    }
                  />
                </View>
              );
            })}
          </Glass>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.xs,
  },
  headerText: { flex: 1, gap: 2 },
  flex: { flex: 1 },
  sectionRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  edgeRight: { marginRight: -space.lg },
  card: { padding: layout.cardPadding, gap: space.md },
  pressed: { opacity: 0.7 },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: layout.touchTarget + space.lg,
  },
  reviewIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewText: { flex: 1, gap: 2 },
  list: { paddingHorizontal: space.lg, paddingVertical: space.xs },
  divider: { borderTopWidth: StyleSheet.hairlineWidth * 2 },
});
