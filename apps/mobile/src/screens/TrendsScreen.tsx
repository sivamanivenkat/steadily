import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import {
  AppText,
  CategoryTile,
  categoryMeta,
  Glass,
  IconButton,
  OnDeviceBadge,
  Screen,
  ScreenHeader,
  SectionLabel,
  StatusPill,
} from '@/components';
import { useData, useNow } from '@/data';
import { addMonths } from '@/data/trends';
import type { CategorySpend, MerchantSpend, MonthSpend, Trends } from '@/data/types';
import { formatMonth, formatMonthYear, formatShortMonth, monthRange } from '@/lib/dates';
import { formatMoney, spokenMoney } from '@/lib/money';
import { categoryColors, layout, radius, space, useTheme } from '@/theme';

/** The current month and the 11 before it. */
export const TREND_MONTH_CHOICES = 12;
const CHART_HEIGHT = 120;
const BAR_RADIUS = 6;
/** Faded bars for the months that are not selected. */
const OTHER_BAR_OPACITY = 0.35;

const money = (cents: number) => formatMoney(cents, { cents: 'auto' });

/** Share of `total`, whole percent. */
function percentOf(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

/** "$45 more than September", "$120 less than September", "Same as September". */
export function deltaLabel(
  totalMinor: number,
  previousMinor: number,
  previousMonth: string,
): { text: string; spoken: string; direction: 'up' | 'down' | 'same' } | null {
  if (totalMinor === 0 && previousMinor === 0) return null;
  const diff = totalMinor - previousMinor;
  if (diff === 0) {
    return {
      text: `Same as ${previousMonth}`,
      spoken: `Same as ${previousMonth}`,
      direction: 'same',
    };
  }
  const word = diff > 0 ? 'more' : 'less';
  return {
    text: `${money(Math.abs(diff))} ${word} than ${previousMonth}`,
    spoken: `${spokenMoney(Math.abs(diff))} ${word} than ${previousMonth}`,
    direction: diff > 0 ? 'up' : 'down',
  };
}

/** Text version of the bar chart, for screen readers and as a visible summary. */
export function chartSummary(months: readonly MonthSpend[]): { text: string; spoken: string } {
  const counted = months.filter((m) => m.totalMinor > 0);
  if (counted.length === 0) return { text: 'Nothing logged yet', spoken: 'Nothing logged yet' };
  const average = Math.round(counted.reduce((sum, m) => sum + m.totalMinor, 0) / counted.length);
  const highest = counted.reduce((a, b) => (b.totalMinor > a.totalMinor ? b : a));
  const highMonth = formatMonth(new Date(highest.month.from));
  return {
    text: `About ${money(average)} a month · highest in ${highMonth}`,
    spoken: `About ${spokenMoney(average)} a month on average. Highest in ${highMonth}, ${spokenMoney(highest.totalMinor)}.`,
  };
}

function MonthChart({
  months,
  selectedFrom,
  canSelect,
  onSelect,
}: {
  months: readonly MonthSpend[];
  selectedFrom: string;
  canSelect: (month: MonthSpend) => boolean;
  onSelect: (month: MonthSpend) => void;
}) {
  const { colors } = useTheme();
  const max = Math.max(1, ...months.map((m) => m.totalMinor));
  return (
    <View style={styles.chart}>
      {months.map((m) => {
        const date = new Date(m.month.from);
        const selected = m.month.from === selectedFrom;
        const height = m.totalMinor > 0 ? Math.max(4, (m.totalMinor / max) * CHART_HEIGHT) : 0;
        const enabled = canSelect(m);
        return (
          <Pressable
            key={m.month.from}
            onPress={() => onSelect(m)}
            disabled={!enabled}
            accessibilityRole="button"
            accessibilityLabel={`${formatMonthYear(date)}: ${spokenMoney(m.totalMinor)}`}
            accessibilityState={{ selected, disabled: !enabled }}
            style={({ pressed }) => [styles.column, pressed && styles.pressed]}
          >
            <Svg width="100%" height={CHART_HEIGHT}>
              {/* Baseline so empty months still show a slot. */}
              <Rect
                x="15%"
                y={CHART_HEIGHT - 2}
                width="70%"
                height={2}
                rx={1}
                fill={colors.track}
              />
              {height > 0 ? (
                <Rect
                  x="15%"
                  y={CHART_HEIGHT - height}
                  width="70%"
                  height={height}
                  rx={BAR_RADIUS}
                  fill={colors.accent}
                  fillOpacity={selected ? 1 : OTHER_BAR_OPACITY}
                />
              ) : null}
            </Svg>
            <AppText
              variant={selected ? 'captionStrong' : 'caption'}
              color={selected ? colors.ink : colors.ink2}
              numberOfLines={1}
            >
              {formatShortMonth(date)}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function CategoryRow({
  item,
  totalMinor,
  onPress,
}: {
  item: CategorySpend;
  totalMinor: number;
  onPress: () => void;
}) {
  const { colors, scheme } = useTheme();
  const meta = categoryMeta(item.categoryId);
  const tint = categoryColors(item.categoryId, scheme);
  const percent = percentOf(item.amountMinor, totalMinor);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${meta.name}: ${spokenMoney(item.amountMinor)}, ${percent} percent of spending`}
      accessibilityHint="Shows these transactions in Activity"
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <CategoryTile categoryId={item.categoryId} icon={meta.icon} />
      <View style={styles.rowText}>
        <View style={styles.rowLine}>
          <AppText variant="bodyStrong" style={styles.flex} numberOfLines={2}>
            {meta.name}
          </AppText>
          <AppText variant="amount">{formatMoney(item.amountMinor)}</AppText>
        </View>
        <View style={[styles.track, { backgroundColor: colors.track }]}>
          <View
            style={[styles.fill, { width: `${Math.max(percent, 1)}%`, backgroundColor: tint.ink }]}
          />
        </View>
        <AppText variant="caption" color={colors.ink2}>
          {percent}% of spending
        </AppText>
      </View>
    </Pressable>
  );
}

function MerchantRow({ item }: { item: MerchantSpend }) {
  const { colors } = useTheme();
  const purchases = `${item.count} ${item.count === 1 ? 'purchase' : 'purchases'}`;
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${item.name}: ${spokenMoney(item.amountMinor)}, ${purchases}`}
    >
      <View style={styles.rowText}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {item.name}
        </AppText>
        <AppText variant="caption" color={colors.ink2}>
          {purchases}
        </AppText>
      </View>
      <AppText variant="amount">{formatMoney(item.amountMinor)}</AppText>
    </View>
  );
}

function Divided({ children }: { children: ReactNode[] }) {
  const { colors } = useTheme();
  return (
    <>
      {children.map((child, i) => (
        <View key={i} style={i > 0 && [styles.divider, { borderTopColor: colors.hairline }]}>
          {child}
        </View>
      ))}
    </>
  );
}

function TrendsBody({
  trends,
  isCurrentMonth,
  onSelectMonth,
  canSelectMonth,
}: {
  trends: Trends;
  isCurrentMonth: boolean;
  onSelectMonth: (month: MonthSpend) => void;
  canSelectMonth: (month: MonthSpend) => boolean;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const monthDate = new Date(trends.month.from);
  const monthName = formatMonth(monthDate);
  const previousName = formatMonth(addMonths(monthDate, -1));
  const delta = deltaLabel(trends.totalMinor, trends.previousTotalMinor, previousName);
  const summary = chartSummary(trends.months);
  const anySpending = trends.months.some((m) => m.totalMinor > 0);

  if (!anySpending) {
    return (
      <Glass variant="strong" radius={radius.card} contentStyle={styles.card}>
        <AppText variant="heading">
          {isCurrentMonth
            ? 'No spending to compare yet'
            : `Nothing logged in ${formatMonthYear(monthDate)}`}
        </AppText>
        <AppText variant="body" color={colors.ink2}>
          {isCurrentMonth
            ? 'Trends fill in as Steadily logs your purchases. Check back after a few alerts.'
            : 'Steadily only knows about purchases logged on this phone.'}
        </AppText>
      </Glass>
    );
  }

  return (
    <>
      <Glass variant="strong" radius={radius.card} contentStyle={styles.card}>
        <View style={styles.cardHeader}>
          <AppText variant="heading" color={colors.ink2}>
            Spent in {monthName}
          </AppText>
          <OnDeviceBadge />
        </View>
        <AppText
          variant="amountL"
          accessibilityLabel={`Spent in ${monthName}: ${spokenMoney(trends.totalMinor)}`}
        >
          {money(trends.totalMinor)}
        </AppText>
        {delta ? (
          <View accessible accessibilityLabel={delta.spoken}>
            <StatusPill
              label={delta.text}
              tone={
                delta.direction === 'up'
                  ? 'headsUp'
                  : delta.direction === 'down'
                    ? 'onTrack'
                    : 'neutral'
              }
              {...(delta.direction === 'same'
                ? {}
                : {
                    icon: delta.direction === 'up' ? ('arrowUp' as const) : ('arrowDown' as const),
                  })}
            />
          </View>
        ) : null}
      </Glass>

      <SectionLabel>Last 6 months</SectionLabel>
      <Glass variant="light" radius={radius.cardSmall} contentStyle={styles.card}>
        <AppText variant="caption" color={colors.ink2} accessibilityLabel={summary.spoken}>
          {summary.text}
        </AppText>
        <MonthChart
          months={trends.months}
          selectedFrom={trends.month.from}
          canSelect={canSelectMonth}
          onSelect={onSelectMonth}
        />
      </Glass>

      <SectionLabel>By category</SectionLabel>
      {trends.byCategory.length > 0 ? (
        <Glass variant="light" radius={radius.cardSmall} contentStyle={styles.list}>
          <Divided>
            {trends.byCategory.map((item) => (
              <CategoryRow
                key={item.categoryId}
                item={item}
                totalMinor={trends.totalMinor}
                onPress={() =>
                  router.navigate({
                    pathname: '/activity',
                    params: { category: item.categoryId, since: trends.month.from },
                  })
                }
              />
            ))}
          </Divided>
        </Glass>
      ) : (
        <AppText variant="body" color={colors.ink2}>
          No spending logged in {monthName}.
        </AppText>
      )}

      {trends.topMerchants.length > 0 ? (
        <>
          <SectionLabel>Top merchants</SectionLabel>
          <Glass variant="light" radius={radius.cardSmall} contentStyle={styles.list}>
            <Divided>
              {trends.topMerchants.map((item) => (
                <MerchantRow key={item.name} item={item} />
              ))}
            </Divided>
          </Glass>
        </>
      ) : null}
    </>
  );
}

/**
 * Trends: a month's spending against the month before, by category and merchant, and the last
 * six months as a bar chart. Worked out on this phone.
 */
export function TrendsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const now = useNow();
  /** 0 = this month, up to 11 months back. */
  const [offset, setOffset] = useState(0);
  const month = addMonths(now, -offset);
  const range = monthRange(month);
  const { data: trends, error } = useData((source) => source.getTrends(month), [range.from]);
  const ready = trends !== undefined && trends.month.from === range.from;

  const offsetOf = (m: MonthSpend) => {
    const d = new Date(m.month.from);
    return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  };

  return (
    <Screen withTabBar={false}>
      <ScreenHeader title="Trends" onBack={() => router.back()} />

      <Glass variant="light" radius={radius.pill} contentStyle={styles.selector}>
        <IconButton
          icon="chevronLeft"
          accessibilityLabel="Previous month"
          disabled={offset >= TREND_MONTH_CHOICES - 1}
          onPress={() => setOffset((o) => Math.min(TREND_MONTH_CHOICES - 1, o + 1))}
        />
        <AppText
          variant="heading"
          style={styles.selectorLabel}
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
        >
          {formatMonthYear(month)}
        </AppText>
        <IconButton
          icon="chevronRight"
          accessibilityLabel="Next month"
          disabled={offset === 0}
          onPress={() => setOffset((o) => Math.max(0, o - 1))}
        />
      </Glass>

      {ready ? (
        <TrendsBody
          trends={trends}
          isCurrentMonth={offset === 0}
          canSelectMonth={(m) => {
            const o = offsetOf(m);
            return o >= 0 && o < TREND_MONTH_CHOICES;
          }}
          onSelectMonth={(m) => setOffset(offsetOf(m))}
        />
      ) : error !== undefined ? (
        <Glass variant="light" radius={radius.cardSmall} contentStyle={styles.card}>
          <AppText variant="body" color={colors.ink2} accessibilityRole="alert">
            Could not add up this month. Try again in a moment.
          </AppText>
        </Glass>
      ) : (
        <Glass variant="light" radius={radius.cardSmall} contentStyle={styles.card}>
          <AppText variant="body" color={colors.ink2} accessibilityLiveRegion="polite">
            Adding up {formatMonth(month)}…
          </AppText>
        </Glass>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.xs,
  },
  selectorLabel: { flex: 1, textAlign: 'center' },
  card: { padding: layout.cardPadding, gap: space.sm },
  cardHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  chart: { flexDirection: 'row', alignItems: 'flex-end', marginTop: space.xs },
  column: {
    flex: 1,
    alignItems: 'center',
    gap: space.xs,
    minHeight: layout.touchTarget,
  },
  list: { paddingHorizontal: space.lg, paddingVertical: space.xs },
  divider: { borderTopWidth: StyleSheet.hairlineWidth * 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.touchTarget + layout.rowPaddingVertical,
    paddingVertical: layout.rowPaddingVertical,
  },
  rowText: { flex: 1, gap: space.xs },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  track: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 6, borderRadius: radius.pill },
});
