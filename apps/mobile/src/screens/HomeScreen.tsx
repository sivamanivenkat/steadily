import { useRouter } from 'expo-router';

import {
  AppText,
  BudgetRow,
  CategoryTile,
  EmptyState,
  IconButton,
  IconTile,
  ListCard,
  ListRow,
  PaceBar,
  SafeToSpendCard,
  Screen,
  ScreenHeader,
  SectionLabel,
  SkeletonHero,
  SkeletonList,
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
import { formatMoney, spokenMoney } from '@/lib/money';
import { nextDueDate, sortByNextDue } from '@/lib/subscriptions';

const RECENT_COUNT = 4;
const BUDGET_COUNT = 3;
const UPCOMING_COUNT = 3;
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
  const upcoming = sortByNextDue(subscriptions ?? [], now).slice(0, UPCOMING_COUNT);

  return (
    <Screen>
      <ScreenHeader
        eyebrow={formatLongDate(now)}
        title={greetingFor(now)}
        right={
          <>
            <IconButton
              icon="plus"
              accessibilityLabel="Add transaction"
              onPress={() => router.push('/add')}
            />
            <IconButton
              icon="chart"
              accessibilityLabel="Spending trends"
              onPress={() => router.push('/trends')}
            />
            <IconButton
              icon="settings"
              accessibilityLabel="Settings"
              onPress={() => router.push('/settings')}
            />
          </>
        }
      />

      {budgets === undefined || subscriptions === undefined ? (
        <SkeletonHero label="Loading safe to spend" />
      ) : safe && monthly ? (
        <SafeToSpendCard
          amountCents={safe.amountMinor}
          untilLabel={formatShortDate(endOfMonth)}
          perDayCents={safe.perDayMinor}
          {...(monthly.basis === 'categories' ? { basisLabel: CATEGORY_BASIS_LABEL } : {})}
          footerLabel={
            monthly.basis === 'categories' ? 'Budgeted categories this month' : 'This month'
          }
          footer={<PaceBar spentRatio={safe.spentRatio} monthRatio={monthRatio} />}
        />
      ) : (
        <EmptyState
          tier="hero"
          icon="budgets"
          title="See what's safe to spend"
          body="Set a monthly budget and Steadily keeps the daily number for you."
          action={{ label: 'Set a budget', onPress: () => router.navigate('/budgets') }}
        />
      )}

      {toReview > 0 ? (
        <ListCard>
          <ListRow
            title={`${toReview} to review`}
            subtitle="Confirm categories in a tap"
            leading={<IconTile icon="inbox" tone="headsUp" />}
            chevron
            onPress={() => router.push('/review')}
            accessibilityLabel={`${toReview} transactions to review`}
            accessibilityHint="Opens the review queue"
          />
        </ListCard>
      ) : null}

      {busiest.length > 0 ? (
        <>
          <SectionLabel
            action={{
              label: 'See all',
              accessibilityLabel: 'See all budgets',
              onPress: () => router.navigate('/budgets'),
            }}
          >
            Budgets
          </SectionLabel>
          <ListCard>
            {busiest.map((row) => (
              <BudgetRow
                key={row.budget.id}
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
            ))}
          </ListCard>
        </>
      ) : null}

      {upcoming.length > 0 ? (
        <>
          <SectionLabel
            action={{
              label: 'See all',
              accessibilityLabel: 'See all subscriptions',
              onPress: () => router.push('/subscriptions'),
            }}
          >
            Upcoming charges
          </SectionLabel>
          <ListCard>
            {upcoming.map(({ subscription: sub }) => {
              const due = formatShortDate(nextDueDate(sub, now));
              return (
                <ListRow
                  key={sub.id}
                  title={sub.merchantName}
                  subtitle={`Due ${due}`}
                  leading={<CategoryTile categoryId={sub.categoryId} />}
                  trailing={<AppText variant="amount">{formatMoney(sub.amountMinor)}</AppText>}
                  onPress={() =>
                    router.push({ pathname: '/subscriptions', params: { id: sub.id } })
                  }
                  accessibilityLabel={`${sub.merchantName}, ${spokenMoney(sub.amountMinor)}, due ${due}`}
                  accessibilityHint="Opens this subscription"
                />
              );
            })}
          </ListCard>
        </>
      ) : null}

      {recent === undefined ? (
        <SkeletonList count={RECENT_COUNT} label="Loading recent transactions" />
      ) : recentRows.length > 0 ? (
        <>
          <SectionLabel
            action={{
              label: 'See all',
              accessibilityLabel: 'See all activity',
              onPress: () => router.navigate('/activity'),
            }}
          >
            Recent
          </SectionLabel>
          <ListCard>
            {recentRows.map((tx) => {
              const badge = badgeFor(tx, subscriptions ?? []);
              return (
                <TransactionRow
                  key={tx.id}
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
              );
            })}
          </ListCard>
        </>
      ) : null}
    </Screen>
  );
}
