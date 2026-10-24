import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import {
  AppText,
  Card,
  CategoryTile,
  EmptyState,
  Icon,
  ListCard,
  categoryMeta,
  Glass,
  OnDeviceBadge,
  Screen,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  SkeletonBlock,
  StatusPill,
  Touchable,
} from '@/components';
import { useData, useNow } from '@/data';
import { addMonths } from '@/data/trends';
import type { CategorySpend, MerchantSpend, MonthSpend, Trends } from '@/data/types';
import { formatMonth, formatMonthYear, formatShortMonth, monthRange } from '@/lib/dates';
import { formatMoney, spokenMoney } from '@/lib/money';
import { cardTier, categoryColors, iconSize, layout, radius, space, useTheme } from '@/theme';

/** The current month and the 11 before it. */
export const TREND_MONTH_CHOICES = 12;
/** Height of the tallest bar. */
const CHART_HEIGHT = 120;
/** Room above the tallest bar for the selected month's value. */
const VALUE_ROOM = 26;
const BAR_RADIUS = 6;
/** Faded bars for months that are not selected; the selected one also gets a value and a backdrop. */
const OTHER_BAR_OPACITY = 0.4;
/** Chart text stops growing here so six month labels never collide; the rows below carry the numbers. */
const CHART_FONT_SCALE = 1.3;

const money = (cents: number) => formatMoney(cents, { cents: 'auto' });

/** Short bar label: "$76", "$1.2k", "$12k". Whole dollars, rounded. */
export function compactMoney(cents: number): string {
  const dollars = Math.round(cents / 100);
  if (dollars < 1000) return `$${dollars}`;
  const thousands = dollars / 1000;
  return `$${thousands.toFixed(thousands < 10 ? 1 : 0).replace(/\.0$/, '')}k`;
}

/** Share of `total`, whole percent. */
function percentOf(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

/** Average of the months that had any spending, or 0. */
export function monthlyAverage(months: readonly MonthSpend[]): number {
  const counted = months.filter((m) => m.totalMinor > 0);
  if (counted.length === 0) return 0;
  return Math.round(counted.reduce((sum, m) => sum + m.totalMinor, 0) / counted.length);
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
  const average = monthlyAverage(months);
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
  const average = monthlyAverage(months);
  // From the top of the plot area (value room + bars); the line spans all columns.
  const averageY = VALUE_ROOM + CHART_HEIGHT - (average / max) * CHART_HEIGHT;
  return (
    <View style={styles.chart}>
      {average > 0 ? (
        <View style={styles.averageLayer} pointerEvents="none">
          <Svg width="100%" height={VALUE_ROOM + CHART_HEIGHT}>
            <Line
              x1="0"
              y1={averageY}
              x2="100%"
              y2={averageY}
              stroke={colors.ink2}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              strokeOpacity={0.7}
            />
          </Svg>
        </View>
      ) : null}
      {months.map((m) => {
        const date = new Date(m.month.from);
        const selected = m.month.from === selectedFrom;
        const height = m.totalMinor > 0 ? Math.max(4, (m.totalMinor / max) * CHART_HEIGHT) : 0;
        const enabled = canSelect(m);
        return (
          <Touchable
            key={m.month.from}
            onPress={() => onSelect(m)}
            disabled={!enabled}
            accessibilityRole="button"
            accessibilityLabel={`${formatMonthYear(date)}: ${spokenMoney(m.totalMinor)}`}
            accessibilityState={{ selected, disabled: !enabled }}
            style={[styles.column, selected && { backgroundColor: colors.accentTint }]}
          >
            <View style={styles.plot}>
              {selected ? (
                <AppText
                  variant="captionStrong"
                  color={colors.accentInk}
                  tabular
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}
                  maxFontSizeMultiplier={CHART_FONT_SCALE}
                  style={styles.value}
                >
                  {compactMoney(m.totalMinor)}
                </AppText>
              ) : null}
              {height > 0 ? (
                <View
                  style={[
                    styles.bar,
                    {
                      height,
                      backgroundColor: colors.accent,
                      opacity: selected ? 1 : OTHER_BAR_OPACITY,
                    },
                  ]}
                />
              ) : null}
              {/* Baseline so empty months still show a slot. */}
              <View style={[styles.baseline, { backgroundColor: colors.track }]} />
            </View>
            <AppText
              variant={selected ? 'captionStrong' : 'caption'}
              color={selected ? colors.ink : colors.ink2}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              maxFontSizeMultiplier={CHART_FONT_SCALE}
            >
              {formatShortMonth(date)}
            </AppText>
          </Touchable>
        );
      })}
    </View>
  );
}

/** Short dashed stroke: the legend key for the chart's average line. */
function DashSwatch({ color }: { color: string }) {
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width={18} height={4}>
        <Line x1={0} y1={2} x2={18} y2={2} stroke={color} strokeWidth={2} strokeDasharray="4 3" />
      </Svg>
    </View>
  );
}

/** Placeholder that matches the hero, chart and category list, so nothing jumps on load. */
function TrendsSkeleton({ label }: { label: string }) {
  return (
    <Skeleton label={label} style={styles.skeleton}>
      <Glass
        variant="strong"
        radius={cardTier.hero.radius}
        contentStyle={[styles.skeletonHero, { padding: cardTier.hero.padding }]}
      >
        <SkeletonBlock width="40%" height={16} />
        <SkeletonBlock width="55%" height={36} rounded={10} />
        <SkeletonBlock width="45%" height={24} rounded={radius.pill} />
      </Glass>
      <Glass
        variant="light"
        radius={cardTier.standard.radius}
        contentStyle={[styles.card, { padding: cardTier.standard.padding }]}
      >
        <SkeletonBlock width="65%" height={12} />
        <View style={styles.skeletonBars}>
          {[0.5, 0.8, 0.35, 0.65, 1, 0.55].map((h, i) => (
            <SkeletonBlock key={i} width="10%" height={CHART_HEIGHT * h} rounded={BAR_RADIUS} />
          ))}
        </View>
      </Glass>
      <Glass variant="light" radius={cardTier.list.radius} contentStyle={styles.skeletonList}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.row}>
            <SkeletonBlock width={40} height={40} rounded={radius.tile} />
            <View style={styles.rowText}>
              <SkeletonBlock width="50%" height={14} />
              <SkeletonBlock width="100%" height={6} rounded={radius.pill} />
            </View>
          </View>
        ))}
      </Glass>
    </Skeleton>
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
    <Touchable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${meta.name}: ${spokenMoney(item.amountMinor)}, ${percent} percent of spending`}
      accessibilityHint="Shows these transactions in Activity"
      style={styles.row}
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
        <AppText variant="caption" color={colors.ink2} tabular>
          {percent}% of spending
        </AppText>
      </View>
      <Icon name="chevronRight" size={iconSize.md} color={colors.ink2} />
    </Touchable>
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
      <EmptyState
        tier="hero"
        icon="chart"
        title={
          isCurrentMonth
            ? 'No spending to compare yet'
            : `Nothing logged in ${formatMonthYear(monthDate)}`
        }
        body={
          isCurrentMonth
            ? 'Trends fill in as Steadily logs your purchases. Check back after a few alerts.'
            : 'Steadily only knows about purchases logged on this phone.'
        }
      />
    );
  }

  return (
    <>
      <Card tier="hero" contentStyle={styles.card}>
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
      </Card>

      <SectionLabel>Last 6 months</SectionLabel>
      <Card contentStyle={styles.card}>
        <View style={styles.legend}>
          <DashSwatch color={colors.ink2} />
          <AppText
            variant="caption"
            color={colors.ink2}
            tabular
            accessibilityLabel={summary.spoken}
            style={styles.flex}
          >
            {summary.text}
          </AppText>
        </View>
        <MonthChart
          months={trends.months}
          selectedFrom={trends.month.from}
          canSelect={canSelectMonth}
          onSelect={onSelectMonth}
        />
      </Card>

      <SectionLabel>By category</SectionLabel>
      {trends.byCategory.length > 0 ? (
        <ListCard>
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
        </ListCard>
      ) : (
        <EmptyState
          icon="chart"
          tone="neutral"
          title={`No spending logged in ${monthName}`}
          body="Pick another month in the chart to see where the money went."
        />
      )}

      {trends.topMerchants.length > 0 ? (
        <>
          <SectionLabel>Top merchants</SectionLabel>
          <ListCard>
            {trends.topMerchants.map((item) => (
              <MerchantRow key={item.name} item={item} />
            ))}
          </ListCard>
        </>
      ) : null}
    </>
  );
}

/**
 * Month stepper arrow. Enabled: accent-tinted circle with an accent chevron. Disabled (end of the
 * range): no fill and a muted chevron, so the two states differ by shape as well as strength and
 * stay readable on dark glass.
 */
function StepButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: 'chevronLeft' | 'chevronRight';
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      feedback="scale"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={4}
      style={[styles.step, !disabled && { backgroundColor: colors.accentTint }]}
    >
      <Icon
        name={icon}
        size={iconSize.md}
        color={disabled ? colors.ink2 : colors.accentInk}
        strokeWidth={disabled ? 1.6 : 2.2}
      />
    </Touchable>
  );
}

/**
 * Trends: a month's spending against the month before, by category and merchant, and the last
 * six months as a bar chart. Worked out on this phone.
 */
export function TrendsScreen() {
  const router = useRouter();
  const now = useNow();
  /** 0 = this month, up to 11 months back. */
  const [offset, setOffset] = useState(0);
  /** Bumped by "Try again" to re-run the query. */
  const [attempt, setAttempt] = useState(0);
  const month = addMonths(now, -offset);
  const range = monthRange(month);
  const { data: trends, error } = useData(
    (source) => source.getTrends(month),
    [range.from, attempt],
  );
  const ready = trends !== undefined && trends.month.from === range.from;

  const offsetOf = (m: MonthSpend) => {
    const d = new Date(m.month.from);
    return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  };

  return (
    <Screen withTabBar={false}>
      <ScreenHeader title="Trends" onBack={() => router.back()} />

      <Glass variant="light" radius={radius.pill} contentStyle={styles.selector}>
        <StepButton
          icon="chevronLeft"
          label="Previous month"
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
        <StepButton
          icon="chevronRight"
          label="Next month"
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
        <EmptyState
          icon="chart"
          tone="headsUp"
          title={`Could not add up ${formatMonth(month)}`}
          body="Your data is safe on this phone. Try again in a moment."
          action={{
            label: 'Try again',
            variant: 'secondary',
            onPress: () => setAttempt((a) => a + 1),
          }}
        />
      ) : (
        <TrendsSkeleton label={`Adding up ${formatMonth(month)}…`} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  step: {
    width: layout.touchTarget,
    height: layout.touchTarget,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.xs,
  },
  selectorLabel: { flex: 1, textAlign: 'center' },
  card: { gap: space.sm },
  cardHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  legend: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: space.xxs, marginTop: space.xs },
  averageLayer: {
    position: 'absolute',
    top: space.xs,
    left: 0,
    right: 0,
    height: VALUE_ROOM + CHART_HEIGHT,
  },
  column: {
    flex: 1,
    alignItems: 'center',
    gap: space.xs,
    minHeight: layout.touchTarget,
    paddingTop: space.xs,
    paddingBottom: space.xs,
    borderRadius: radius.button,
  },
  plot: {
    alignSelf: 'stretch',
    height: VALUE_ROOM + CHART_HEIGHT,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  value: { marginBottom: space.xxs, paddingHorizontal: space.xxs },
  bar: {
    width: '62%',
    borderTopLeftRadius: BAR_RADIUS,
    borderTopRightRadius: BAR_RADIUS,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  baseline: { alignSelf: 'stretch', height: 2, borderRadius: 1 },
  skeleton: { gap: layout.cardGap },
  skeletonHero: { gap: space.md },
  skeletonBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    height: CHART_HEIGHT,
  },
  skeletonList: {
    paddingHorizontal: layout.listPaddingHorizontal,
    paddingVertical: layout.listPaddingVertical,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.rowMinHeight,
    paddingVertical: layout.rowPaddingVertical,
  },
  rowText: { flex: 1, minWidth: 0, gap: space.xs },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  track: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 6, borderRadius: radius.pill },
});
