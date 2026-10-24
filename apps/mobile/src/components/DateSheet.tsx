import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { addDays, dayKey, formatLongDate, formatMonthYear, startOfDay } from '@/lib/dates';
import { layout, radius, space, useTheme } from '@/theme';

import { AppText } from './AppText';
import { BottomSheet } from './BottomSheet';
import { CategoryChip } from './CategoryChip';
import { IconButton } from './IconButton';
import { Touchable } from './Touchable';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

type DateSheetProps = {
  visible: boolean;
  title?: string;
  /** The picked day. */
  value: Date;
  /** Earliest day that can be picked. */
  min: Date;
  /** Today: the latest day that can be picked, and what "Today" means. */
  max: Date;
  onSelect: (day: Date) => void;
  onClose: () => void;
};

function firstOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function shiftMonth(month: Date, by: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + by, 1);
}

/** The month as weeks of 7 cells, `null` for the days outside it. Weeks start on Sunday. */
export function monthGrid(month: Date): (Date | null)[][] {
  const first = firstOfMonth(month);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = Array.from({ length: first.getDay() }, () => null);
  for (let d = 1; d <= days; d++) cells.push(new Date(first.getFullYear(), first.getMonth(), d));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * Calendar in a bottom sheet: Today / Yesterday shortcuts, then a month grid. Tapping a day picks
 * it and closes. Built from plain views, so it needs no native date picker.
 */
export function DateSheet({
  visible,
  title = 'Pick a day',
  value,
  min,
  max,
  onSelect,
  onClose,
}: DateSheetProps) {
  const { colors } = useTheme();
  const [month, setMonth] = useState(() => firstOfMonth(value));
  // Reopening shows the month of the current pick again.
  const [shownFor, setShownFor] = useState(visible);
  if (visible !== shownFor) {
    setShownFor(visible);
    if (visible) setMonth(firstOfMonth(value));
  }

  const lo = startOfDay(min);
  const hi = startOfDay(max);
  const today = startOfDay(max);
  const yesterday = addDays(today, -1);
  const selectedKey = dayKey(value);
  const canBack = month > firstOfMonth(lo);
  const canForward = shiftMonth(month, 1) <= hi;
  const pick = (day: Date) => onSelect(day);

  return (
    <BottomSheet visible={visible} onClose={onClose} dismissLabel="Close calendar">
      <View style={styles.header}>
        <AppText variant="heading" accessibilityRole="header" style={styles.flex}>
          {title}
        </AppText>
        <IconButton icon="close" accessibilityLabel="Close" onPress={onClose} flat />
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.quick}>
          <CategoryChip
            kind="filter"
            label="Today"
            selected={selectedKey === dayKey(today)}
            onPress={() => pick(today)}
          />
          {yesterday >= lo ? (
            <CategoryChip
              kind="filter"
              label="Yesterday"
              selected={selectedKey === dayKey(yesterday)}
              onPress={() => pick(yesterday)}
            />
          ) : null}
        </View>

        <View style={styles.monthRow}>
          <IconButton
            icon="chevronLeft"
            accessibilityLabel="Previous month"
            onPress={() => setMonth((m) => shiftMonth(m, -1))}
            disabled={!canBack}
            flat
          />
          <AppText
            variant="bodyStrong"
            style={styles.monthTitle}
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
          >
            {formatMonthYear(month)}
          </AppText>
          <IconButton
            icon="chevronRight"
            accessibilityLabel="Next month"
            onPress={() => setMonth((m) => shiftMonth(m, 1))}
            disabled={!canForward}
            flat
          />
        </View>

        <View style={styles.week} importantForAccessibility="no-hide-descendants">
          {WEEKDAYS.map((d, i) => (
            <AppText
              key={i}
              variant="captionStrong"
              color={colors.ink2}
              style={styles.weekday}
              accessible={false}
            >
              {d}
            </AppText>
          ))}
        </View>

        {monthGrid(month).map((week, w) => (
          <View key={w} style={styles.week}>
            {week.map((day, i) => {
              if (!day) return <View key={i} style={styles.cell} />;
              const key = dayKey(day);
              const selected = key === selectedKey;
              const isToday = key === dayKey(today);
              const disabled = day < lo || day > hi;
              return (
                <View key={i} style={styles.cell}>
                  <Touchable
                    onPress={() => pick(day)}
                    disabled={disabled}
                    feedback="scale"
                    accessibilityRole="button"
                    accessibilityLabel={`${isToday ? 'Today, ' : ''}${formatLongDate(day)}`}
                    accessibilityState={{ selected, disabled }}
                    style={[
                      styles.day,
                      selected && { backgroundColor: colors.accent },
                      !selected && isToday && [styles.today, { borderColor: colors.accent }],
                      disabled && styles.disabled,
                    ]}
                  >
                    <AppText
                      variant={selected || isToday ? 'bodyStrong' : 'body'}
                      color={selected ? colors.onAccent : isToday ? colors.accentInk : colors.ink}
                      tabular
                    >
                      {day.getDate()}
                    </AppText>
                  </Touchable>
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  body: { gap: space.xs, paddingBottom: space.sm },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.sm },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  monthTitle: { flex: 1, textAlign: 'center' },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', paddingVertical: space.xs },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  day: {
    minWidth: layout.touchTarget,
    minHeight: layout.touchTarget,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
  },
  today: { borderWidth: 2 },
  disabled: { opacity: 0.35 },
});
