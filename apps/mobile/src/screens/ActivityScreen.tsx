import { CATEGORIES, isBuiltInCategoryId, type CategoryId } from '@steadily/taxonomy';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  AppText,
  CategoryChip,
  Glass,
  Icon,
  IconButton,
  Screen,
  SearchField,
  TransactionRow,
} from '@/components';
import { useData, useNow } from '@/data';
import type { Transaction } from '@/data/types';
import { spendingDelta } from '@/lib/budget';
import { dayHeading, dayKey, formatTime, recentRange } from '@/lib/dates';
import { formatMoney, spokenMoney } from '@/lib/money';
import { iconSize, layout, radius, space, useTheme } from '@/theme';

export type DayGroup = { key: string; date: Date; totalMinor: number; items: Transaction[] };

/** Newest-first transactions -> day groups with each day's spending total. */
export function groupByDay(transactions: readonly Transaction[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const tx of transactions) {
    const date = new Date(tx.occurredAt);
    const key = dayKey(date);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, date, totalMinor: 0, items: [] };
      groups.push(group);
    }
    group.items.push(tx);
    group.totalMinor += spendingDelta(tx);
  }
  return groups;
}

export function filterTransactions(
  transactions: readonly Transaction[],
  query: string,
  categoryId: CategoryId | null,
): Transaction[] {
  const q = query.trim().toLowerCase();
  return transactions.filter(
    (tx) =>
      (categoryId === null || tx.categoryId === categoryId) &&
      (q === '' || (tx.merchantName ?? tx.merchantRaw ?? '').toLowerCase().includes(q)),
  );
}

function rowProps(tx: Transaction) {
  if (tx.kind === 'income') return { kindLabel: 'Income', incoming: true };
  if (tx.kind === 'refund') return { kindLabel: 'Refund', incoming: true };
  if (tx.kind === 'transfer') return { kindLabel: 'Not an expense' };
  return {};
}

/**
 * Opening Activity for a category (e.g. from Trends): `category` picks the filter, `since`
 * (ISO) reaches back to an older month when it is before the usual window.
 */
export type ActivityParams = { category?: string; since?: string };

/** Activity tab: every transaction by day, with search and category filters. */
export function ActivityScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const now = useNow();
  const params = useLocalSearchParams<ActivityParams>();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryId | null>(null);

  const paramCategory =
    typeof params.category === 'string' && isBuiltInCategoryId(params.category)
      ? params.category
      : null;
  useEffect(() => {
    if (paramCategory) setCategory(paramCategory);
  }, [paramCategory, params.since]);

  const recent = recentRange(now);
  const since =
    typeof params.since === 'string' && !Number.isNaN(Date.parse(params.since))
      ? params.since
      : null;
  const from = since && Date.parse(since) < Date.parse(recent.from) ? since : recent.from;
  const { data: transactions } = useData(
    (source) => source.listTransactions({ from, to: recent.to }),
    [now, from],
  );
  const { data: review } = useData((source) => source.listNeedsReview());

  const all = transactions ?? [];
  const present = new Set<CategoryId>(all.map((tx) => tx.categoryId));
  if (category !== null) present.add(category);
  const filterIds = CATEGORIES.filter((c) => present.has(c.id)).map((c) => c.id);
  const groups = groupByDay(filterTransactions(all, query, category));
  const reviewCount = review?.length ?? 0;

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="title" accessibilityRole="header" style={styles.flex}>
          Activity
        </AppText>
        <IconButton
          icon="plus"
          accessibilityLabel="Add transaction"
          onPress={() => router.push('/add')}
        />
      </View>

      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder="Search merchants"
        accessibilityLabel="Search merchants"
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filters}
        style={styles.filterStrip}
        accessibilityLabel="Filter by category"
      >
        <Pressable
          onPress={() => setCategory(null)}
          accessibilityRole="button"
          accessibilityLabel="All categories"
          accessibilityState={{ selected: category === null }}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Glass
            variant="light"
            radius={radius.pill}
            shadow={false}
            fixed
            contentStyle={[
              styles.allChip,
              { borderColor: category === null ? colors.ink : colors.solidBorder },
            ]}
          >
            {category === null ? <Icon name="check" size={iconSize.sm} color={colors.ink} /> : null}
            <AppText variant="bodyStrong">All</AppText>
          </Glass>
        </Pressable>
        {filterIds.map((id) => (
          <CategoryChip
            key={id}
            categoryId={id}
            selected={category === id}
            onPress={() => setCategory(category === id ? null : id)}
          />
        ))}
      </ScrollView>

      {reviewCount > 0 ? (
        <Pressable
          onPress={() => router.push('/review')}
          accessibilityRole="button"
          accessibilityLabel={`${reviewCount} transactions to review`}
          accessibilityHint="Opens the review queue"
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Glass variant="light" radius={radius.row} contentStyle={styles.reviewRow}>
            <View style={[styles.reviewIcon, { backgroundColor: colors.headsUp.bg }]}>
              <Icon name="inbox" size={iconSize.md} color={colors.headsUp.text} />
            </View>
            <AppText variant="bodyStrong" style={styles.flex}>
              {reviewCount} to review
            </AppText>
            <Icon name="chevronRight" size={iconSize.md} color={colors.ink2} />
          </Glass>
        </Pressable>
      ) : null}

      {transactions !== undefined && groups.length === 0 ? (
        <Glass variant="light" radius={radius.cardSmall} contentStyle={styles.empty}>
          <AppText variant="heading">No matches</AppText>
          <AppText variant="body" color={colors.ink2}>
            Try another merchant name or category.
          </AppText>
        </Glass>
      ) : null}

      {groups.map((group) => {
        const heading = dayHeading(group.date, now);
        return (
          <View key={group.key} style={styles.group}>
            <View
              style={styles.dayHeader}
              accessible
              accessibilityRole="header"
              accessibilityLabel={`${heading}, spent ${spokenMoney(group.totalMinor)}`}
            >
              <AppText variant="label" color={colors.ink2} style={styles.flex}>
                {heading}
              </AppText>
              <AppText variant="captionStrong" color={colors.ink2} style={styles.tabular}>
                {formatMoney(group.totalMinor)}
              </AppText>
            </View>
            <Glass variant="light" radius={radius.cardSmall} contentStyle={styles.list}>
              {group.items.map((tx, i) => (
                <View
                  key={tx.id}
                  style={i > 0 && [styles.divider, { borderTopColor: colors.hairline }]}
                >
                  <TransactionRow
                    merchant={tx.merchantName ?? tx.merchantRaw ?? 'Unknown merchant'}
                    amountCents={tx.amountMinor}
                    categoryId={tx.categoryId}
                    timeLabel={formatTime(new Date(tx.occurredAt))}
                    {...rowProps(tx)}
                    {...(tx.status === 'needs_review'
                      ? { badge: { kind: 'review' as const, label: 'Needs review' } }
                      : {})}
                    onPress={() =>
                      router.push({ pathname: '/transaction/[id]', params: { id: tx.id } })
                    }
                  />
                </View>
              ))}
            </Glass>
          </View>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  pressed: { opacity: 0.7 },
  filterStrip: { marginHorizontal: -layout.screenPadding },
  filters: { gap: space.sm, paddingHorizontal: layout.screenPadding },
  allChip: {
    minHeight: layout.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    paddingHorizontal: space.lg,
    borderWidth: 2,
  },
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
  empty: { padding: layout.cardPadding, gap: space.xs },
  group: { gap: space.sm },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.xs,
  },
  tabular: { fontVariant: ['tabular-nums'] },
  list: { paddingHorizontal: space.lg, paddingVertical: space.xs },
  divider: { borderTopWidth: StyleSheet.hairlineWidth * 2 },
});
