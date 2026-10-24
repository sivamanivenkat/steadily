import { CATEGORIES, isBuiltInCategoryId, type BuiltInCategoryId } from '@steadily/taxonomy';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import {
  AppText,
  Button,
  Card,
  CategoryChip,
  CategoryPickerSheet,
  CategoryTile,
  EmptyState,
  Glass,
  Icon,
  OnDeviceBadge,
  Screen,
  ScreenHeader,
  SectionLabel,
  SkeletonHero,
  StatusPill,
} from '@/components';
import {
  KEPT_BOOKKEEPING,
  keptFields,
  keptIntro,
  KIND_LABEL,
  notKeptFields,
} from '@/content/privacy';
import { useData, useDataSource, useNow } from '@/data';
import type { Transaction } from '@/data/types';
import { formatLongDate, formatTime, recentRange } from '@/lib/dates';
import { formatMoney, spokenMoney } from '@/lib/money';
import { iconSize, layout, radius, space, type, useTheme } from '@/theme';

const NOTE_MAX = 500;
const QUICK_COUNT = 3;

/**
 * The quick category chips: the categories used most lately (taxonomy order breaks ties and
 * fills in), always including the current one. The full list is one tap away under "More".
 */
export function quickCategories(
  recent: readonly Transaction[],
  current: BuiltInCategoryId | null,
): BuiltInCategoryId[] {
  const counts = new Map<BuiltInCategoryId, number>();
  for (const tx of recent) {
    if (isBuiltInCategoryId(tx.categoryId)) {
      counts.set(tx.categoryId, (counts.get(tx.categoryId) ?? 0) + 1);
    }
  }
  const ranked = CATEGORIES.map((c, i) => ({ id: c.id, i, n: counts.get(c.id) ?? 0 }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((c) => c.id);
  const quick = ranked.slice(0, QUICK_COUNT);
  if (current && !quick.includes(current)) quick[QUICK_COUNT - 1] = current;
  return quick;
}

export function TransactionDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const source = useDataSource();
  const { colors } = useTheme();
  const now = useNow();
  const { data: tx, loading } = useData((s) => s.getTransaction(id), [id]);
  const { data: recent } = useData((s) => s.listTransactions(recentRange(now)), [now]);

  const [note, setNote] = useState('');
  const [noteSaved, setNoteSaved] = useState(false);
  const [picking, setPicking] = useState(false);
  const savedNote = tx?.note ?? '';
  useEffect(() => {
    setNote(savedNote);
  }, [savedNote]);

  // The quick chips are picked once, so they do not reorder under the finger after a change.
  const [quick, setQuick] = useState<BuiltInCategoryId[] | null>(null);
  if (quick === null && tx && recent) {
    setQuick(quickCategories(recent, isBuiltInCategoryId(tx.categoryId) ? tx.categoryId : null));
  }

  const close = () => router.back();
  const header = (
    <ScreenHeader title="Transaction" onBack={close} backIcon="close" backLabel="Close" />
  );

  if (!tx) {
    return (
      <Screen withTabBar={false}>
        {header}
        {loading ? (
          <SkeletonHero label="Loading transaction" />
        ) : (
          <EmptyState
            icon="search"
            tone="neutral"
            title="Transaction not found"
            body="This transaction is no longer here."
            action={{ label: 'Close', variant: 'secondary', onPress: close }}
          />
        )}
      </Screen>
    );
  }

  const merchant = tx.merchantName ?? tx.merchantRaw ?? 'Unknown merchant';
  const occurred = new Date(tx.occurredAt);
  const noteChanged = note.trim() !== savedNote;
  const notKept = notKeptFields(tx);
  const incoming = tx.kind === 'income' || tx.kind === 'refund';
  const selectedId = tx.kind !== 'transfer' ? tx.categoryId : null;
  const chips = quick ?? quickCategories([], null);
  // A category picked from "More" shows as a chip too, so the choice is always visible.
  const shown =
    selectedId && !chips.includes(selectedId as BuiltInCategoryId)
      ? [...chips.slice(0, QUICK_COUNT - 1), selectedId]
      : chips;

  const saveNote = async () => {
    if (!noteChanged) return;
    await source.setNote(tx.id, note);
    setNoteSaved(true);
  };

  return (
    <Screen withTabBar={false}>
      {header}

      <Card tier="hero" contentStyle={styles.summary}>
        <View style={styles.summaryTop}>
          <CategoryTile categoryId={tx.categoryId} />
          <View style={styles.flex}>
            <AppText variant="heading" numberOfLines={2}>
              {merchant}
            </AppText>
            <AppText variant="caption" color={colors.ink2}>
              {formatLongDate(occurred)} · {formatTime(occurred)}
            </AppText>
          </View>
        </View>
        <AppText
          variant="amountL"
          accessibilityLabel={`${incoming ? 'plus ' : ''}${spokenMoney(tx.amountMinor)}`}
        >
          {`${incoming ? '+' : ''}${formatMoney(tx.amountMinor)}`}
        </AppText>
        {tx.status === 'needs_review' || tx.kind !== 'expense' ? (
          <View style={styles.pills}>
            {tx.status === 'needs_review' ? (
              <StatusPill label="Needs review" tone="headsUp" icon="inbox" />
            ) : null}
            {tx.kind !== 'expense' ? (
              <StatusPill label={KIND_LABEL[tx.kind]} tone="neutral" />
            ) : null}
          </View>
        ) : null}
      </Card>

      <SectionLabel>Category</SectionLabel>
      <View style={styles.chips} accessibilityLabel="Category">
        {shown.map((categoryId) => (
          <CategoryChip
            key={categoryId}
            categoryId={categoryId}
            selected={selectedId === categoryId}
            onPress={() => void source.confirmCategory(tx.id, categoryId, false)}
          />
        ))}
        <CategoryChip kind="more" onPress={() => setPicking(true)} />
      </View>
      {tx.kind === 'expense' ? (
        <Button
          label="Not an expense"
          variant="neutralTint"
          onPress={() => void source.markNotExpense(tx.id)}
          accessibilityHint="Keeps it, but leaves it out of your budgets"
        />
      ) : null}

      <SectionLabel>Note</SectionLabel>
      <Glass variant="light" radius={radius.row} shadow={false} contentStyle={styles.noteBox}>
        <TextInput
          value={note}
          onChangeText={(text) => {
            setNote(text);
            setNoteSaved(false);
          }}
          // Leaving the field saves too, so a note is never lost to a missed tap.
          onBlur={() => void saveNote()}
          placeholder="Add a note"
          placeholderTextColor={colors.ink2}
          accessibilityLabel="Note"
          multiline
          maxLength={NOTE_MAX}
          style={[type.body, styles.noteInput, { color: colors.ink }]}
        />
      </Glass>
      {noteChanged ? (
        <Button label="Save note" variant="secondary" onPress={() => void saveNote()} />
      ) : noteSaved ? (
        <View style={styles.saved} accessibilityLiveRegion="polite">
          <Icon name="check" size={iconSize.sm} color={colors.onTrack} />
          <AppText variant="caption" color={colors.ink2}>
            Note saved
          </AppText>
        </View>
      ) : null}

      <SectionLabel>What we kept</SectionLabel>
      <Card contentStyle={styles.kept}>
        <OnDeviceBadge />
        <AppText variant="caption" color={colors.ink2}>
          {keptIntro(tx.source)}
        </AppText>
        <View>
          {keptFields(tx).map((field, i) => (
            <View
              key={field.label}
              style={[
                styles.keptRow,
                i > 0 && [styles.divider, { borderTopColor: colors.hairline }],
              ]}
              accessible
              accessibilityLabel={`${field.label}: ${field.value}`}
            >
              <AppText variant="caption" color={colors.ink2} style={styles.keptLabel}>
                {field.label}
              </AppText>
              <AppText variant="bodyStrong" style={styles.keptValue}>
                {field.value}
              </AppText>
            </View>
          ))}
        </View>
        <AppText variant="caption" color={colors.ink2}>
          {KEPT_BOOKKEEPING}
        </AppText>
      </Card>

      <SectionLabel>What we didn’t keep</SectionLabel>
      <Card contentStyle={styles.kept}>
        {notKept.length === 0 ? (
          <AppText variant="body" color={colors.ink2}>
            Nothing else. You typed these in yourself.
          </AppText>
        ) : (
          <View
            accessibilityRole="list"
            accessibilityLabel="What we didn’t keep"
            style={styles.list}
          >
            {notKept.map((item) => (
              <View key={item} style={styles.notKeptRow} accessible accessibilityLabel={item}>
                <Icon name="close" size={iconSize.sm} color={colors.ink2} />
                <AppText variant="body" style={styles.flex}>
                  {item}
                </AppText>
              </View>
            ))}
          </View>
        )}
      </Card>

      <CategoryPickerSheet
        visible={picking}
        selectedId={selectedId}
        onSelect={(categoryId) => {
          setPicking(false);
          void source.confirmCategory(tx.id, categoryId, false);
        }}
        onClose={() => setPicking(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: space.xxs },
  summary: { gap: space.md },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  noteBox: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  noteInput: { minHeight: layout.touchTarget * 2, textAlignVertical: 'top' },
  saved: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.xs,
    marginTop: -space.xs,
  },
  kept: { gap: space.sm },
  keptRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingVertical: space.sm,
  },
  keptLabel: { flexShrink: 0 },
  keptValue: { flexShrink: 1, textAlign: 'right' },
  divider: { borderTopWidth: StyleSheet.hairlineWidth * 2 },
  list: { gap: space.sm },
  notKeptRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
});
