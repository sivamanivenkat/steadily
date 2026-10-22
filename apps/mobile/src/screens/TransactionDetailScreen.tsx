import { CATEGORIES } from '@steadily/taxonomy';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import {
  AppText,
  Button,
  CategoryChip,
  CategoryTile,
  Glass,
  Icon,
  OnDeviceBadge,
  Screen,
  ScreenHeader,
  SectionLabel,
  StatusPill,
} from '@/components';
import {
  KEPT_BOOKKEEPING,
  keptFields,
  keptIntro,
  KIND_LABEL,
  notKeptFields,
} from '@/content/privacy';
import { useData, useDataSource } from '@/data';
import { formatLongDate, formatTime } from '@/lib/dates';
import { formatMoney, spokenMoney } from '@/lib/money';
import { iconSize, layout, radius, space, type, useTheme } from '@/theme';

const NOTE_MAX = 500;

export function TransactionDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const source = useDataSource();
  const { colors } = useTheme();
  const { data: tx, loading } = useData((s) => s.getTransaction(id), [id]);

  const [note, setNote] = useState('');
  const savedNote = tx?.note ?? '';
  useEffect(() => {
    setNote(savedNote);
  }, [savedNote]);

  const header = (
    <ScreenHeader
      title="Transaction"
      onBack={() => router.back()}
      backIcon="close"
      backLabel="Close"
    />
  );

  if (!tx) {
    return (
      <Screen withTabBar={false}>
        {header}
        {loading ? null : (
          <AppText variant="body" color={colors.ink2}>
            This transaction is no longer here.
          </AppText>
        )}
      </Screen>
    );
  }

  const merchant = tx.merchantName ?? tx.merchantRaw ?? 'Unknown merchant';
  const occurred = new Date(tx.occurredAt);
  const noteChanged = note.trim() !== savedNote;
  const notKept = notKeptFields(tx);

  return (
    <Screen withTabBar={false}>
      {header}

      <Glass variant="strong" radius={radius.card} contentStyle={styles.summary}>
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
          accessibilityLabel={`${tx.kind === 'income' ? 'plus ' : ''}${spokenMoney(tx.amountMinor)}`}
        >
          {`${tx.kind === 'income' ? '+' : ''}${formatMoney(tx.amountMinor)}`}
        </AppText>
        <View style={styles.pills}>
          {tx.status === 'needs_review' ? (
            <StatusPill label="Needs review" tone="headsUp" icon="inbox" />
          ) : null}
          {tx.kind !== 'expense' ? <StatusPill label={KIND_LABEL[tx.kind]} tone="neutral" /> : null}
        </View>
      </Glass>

      <SectionLabel>Category</SectionLabel>
      <View style={styles.chips} accessibilityLabel="Category">
        {CATEGORIES.map((c) => (
          <CategoryChip
            key={c.id}
            categoryId={c.id}
            selected={tx.categoryId === c.id && tx.kind !== 'transfer'}
            onPress={() => void source.confirmCategory(tx.id, c.id, false)}
          />
        ))}
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
          onChangeText={setNote}
          placeholder="Add a note"
          placeholderTextColor={colors.ink2}
          accessibilityLabel="Note"
          multiline
          maxLength={NOTE_MAX}
          style={[type.body, styles.noteInput, { color: colors.ink }]}
        />
      </Glass>
      <Button
        label="Save note"
        variant="secondary"
        disabled={!noteChanged}
        onPress={() => void source.setNote(tx.id, note)}
      />

      <SectionLabel>What we kept</SectionLabel>
      <Glass variant="light" radius={radius.cardSmall} contentStyle={styles.kept}>
        <OnDeviceBadge />
        <AppText variant="caption" color={colors.ink2}>
          {keptIntro(tx.source)}
        </AppText>
        {keptFields(tx).map((field, i) => (
          <View
            key={field.label}
            style={[styles.keptRow, i > 0 && [styles.divider, { borderTopColor: colors.hairline }]]}
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
        <AppText variant="caption" color={colors.ink2}>
          {KEPT_BOOKKEEPING}
        </AppText>
      </Glass>

      <SectionLabel>What we didn’t keep</SectionLabel>
      <Glass variant="light" radius={radius.cardSmall} contentStyle={styles.kept}>
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
      </Glass>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  summary: { padding: layout.cardPadding + 2, gap: space.md },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  noteBox: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  noteInput: { minHeight: layout.touchTarget * 2, textAlignVertical: 'top' },
  kept: { padding: layout.cardPadding, gap: space.sm },
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
