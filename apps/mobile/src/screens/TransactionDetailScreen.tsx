import type { CaptureSource, CategorySource, TransactionKind } from '@steadily/shared-types';
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
  OnDeviceBadge,
  Screen,
  ScreenHeader,
  SectionLabel,
  StatusPill,
} from '@/components';
import { categoryMeta } from '@/components/CategoryTile';
import { issuerName, useData, useDataSource } from '@/data';
import type { Transaction } from '@/data/types';
import { dateTimeLabel, formatLongDate, formatTime } from '@/lib/dates';
import { formatMoney, spokenMoney } from '@/lib/money';
import { layout, radius, space, type, useTheme } from '@/theme';

const NOTE_MAX = 500;

const SOURCE_LABEL: Record<CaptureSource, string> = {
  android_notification: 'Bank app notification',
  ios_sms_shortcut: 'Text message alert',
  ios_apple_pay_shortcut: 'Apple Pay',
  share_text: 'Shared text',
  share_image: 'Shared screenshot',
  share_pdf: 'Shared PDF',
  csv_import: 'Statement import',
  manual: 'Added by you',
};

const CATEGORY_SOURCE_LABEL: Record<CategorySource, string> = {
  user: 'Chosen by you',
  user_rule: 'Your rule for this merchant',
  dictionary: 'Known merchant',
  classifier: 'Best guess on this phone',
  on_device_llm: 'Best guess on this phone',
  cloud_llm: 'Cloud AI (you opted in)',
  none: 'Not categorized',
};

const KIND_LABEL: Record<TransactionKind, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Not an expense',
  refund: 'Refund',
};

/**
 * "What we kept" (D-011): the stored fields of a transaction and nothing else. The alert text it
 * came from is never stored, so it can never be shown.
 */
export function keptFields(tx: Transaction): { label: string; value: string }[] {
  return [
    { label: 'Amount', value: `${formatMoney(tx.amountMinor)} ${tx.currency}` },
    { label: 'Merchant as written', value: tx.merchantRaw ?? 'Not captured' },
    { label: 'Merchant', value: tx.merchantName ?? 'Not captured' },
    { label: 'Date and time', value: dateTimeLabel(new Date(tx.occurredAt)) },
    { label: 'Card', value: tx.accountLast4 ? `Ending ${tx.accountLast4}` : 'Not captured' },
    { label: 'Bank or app', value: issuerName(tx.issuerId) ?? 'Not captured' },
    { label: 'Captured from', value: SOURCE_LABEL[tx.source] },
    { label: 'Type', value: KIND_LABEL[tx.kind] },
    {
      label: 'Category',
      value: `${categoryMeta(tx.categoryId).name} (${CATEGORY_SOURCE_LABEL[tx.categorySource]})`,
    },
    { label: 'Reference number', value: tx.txnRef ?? 'None' },
    { label: 'Note', value: tx.note ?? 'None' },
  ];
}

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
          Only these fields are stored, encrypted on this phone. The alert text was read here and
          deleted right away. We never keep full card numbers, balances or passwords.
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
});
