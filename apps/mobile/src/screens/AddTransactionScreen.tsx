import { FALLBACK_CATEGORY_ID, type CategoryId } from '@steadily/taxonomy';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import {
  AppText,
  Button,
  Card,
  CategoryPickerSheet,
  CategoryTile,
  DateSheet,
  Glass,
  Icon,
  IconButton,
  IconTile,
  ListCard,
  ListRow,
  OnDeviceBadge,
  Screen,
  ScreenHeader,
  SectionLabel,
  Touchable,
} from '@/components';
import { categoryMeta } from '@/components/CategoryTile';
import { useDataSource, useNow } from '@/data';
import { MAX_MERCHANT_LENGTH, MAX_NOTE_LENGTH } from '@/data/manual';
import type { ManualKind } from '@/data/types';
import { addDays, dayHeading, formatShortDate, startOfDay } from '@/lib/dates';
import { centsFromDigits, centsInputText, spokenMoney } from '@/lib/money';
import { iconSize, layout, maxFontScale, radius, space, type, useTheme } from '@/theme';

const KINDS: readonly { value: ManualKind; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'refund', label: 'Refund' },
];

/** How far back the day stepper and calendar go. */
const MAX_DAYS_BACK = 365;
const DAY_MS = 86_400_000;

/** The picked day at the current time of day, so the entry sorts naturally among captures. */
export function occurredAtFor(daysBack: number, now: Date): Date {
  const day = addDays(startOfDay(now), -daysBack);
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    now.getHours(),
    now.getMinutes(),
  );
}

/** Whole days from `day` back to today (rounded, so daylight-saving shifts do not matter). */
function daysBackTo(day: Date, now: Date): number {
  return Math.round((startOfDay(now).getTime() - startOfDay(day).getTime()) / DAY_MS);
}

/** Segmented choice of Expense / Income / Refund. The pick shows a check, not color alone. */
function KindPicker({
  value,
  onChange,
}: {
  value: ManualKind;
  onChange: (kind: ManualKind) => void;
}) {
  const { colors } = useTheme();
  return (
    <Glass variant="light" radius={radius.pill} elevation="none" fixed contentStyle={styles.kinds}>
      <View style={styles.kindRow} accessibilityRole="radiogroup" accessibilityLabel="Type">
        {KINDS.map((kind) => {
          const selected = kind.value === value;
          return (
            <Touchable
              key={kind.value}
              onPress={() => onChange(kind.value)}
              accessibilityRole="radio"
              accessibilityLabel={kind.label}
              accessibilityState={{ checked: selected }}
              style={[styles.kind, selected && { backgroundColor: colors.accentTint }]}
            >
              {selected ? <Icon name="check" size={iconSize.sm} color={colors.accentInk} /> : null}
              <AppText
                variant={selected ? 'bodyStrong' : 'body'}
                color={selected ? colors.accentInk : colors.ink2}
              >
                {kind.label}
              </AppText>
            </Touchable>
          );
        })}
      </View>
    </Glass>
  );
}

/**
 * Add a transaction by hand (Home "+", Activity "+", the Android Quick Settings tile through
 * `steadily://add`). Saved on this phone through the same pipeline as captured alerts.
 */
export function AddTransactionScreen() {
  const router = useRouter();
  const source = useDataSource();
  const { colors } = useTheme();
  const now = useNow();

  const [kind, setKind] = useState<ManualKind>('expense');
  const [cents, setCents] = useState(0);
  const [merchant, setMerchant] = useState('');
  const [categoryId, setCategoryId] = useState<CategoryId | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickingDay, setPickingDay] = useState(false);
  const [daysBack, setDaysBack] = useState(0);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const needsCategory = kind !== 'income';
  const canSave =
    cents > 0 && merchant.trim() !== '' && (!needsCategory || categoryId !== null) && !saving;
  const day = occurredAtFor(daysBack, now);
  const dayLabel =
    daysBack < 2 ? `${dayHeading(day, now)}, ${formatShortDate(day)}` : dayHeading(day, now);
  const missing = [
    cents > 0 ? null : 'an amount',
    merchant.trim() !== '' ? null : kind === 'income' ? 'who it is from' : 'a merchant',
    !needsCategory || categoryId !== null ? null : 'a category',
  ].filter(Boolean);

  const close = () => {
    // Opened from the tile on a cold start there is nothing to go back to.
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await source.addManualTransaction({
        amountMinor: cents,
        merchant,
        categoryId: categoryId ?? FALLBACK_CATEGORY_ID,
        occurredAt: day.toISOString(),
        kind,
        note: note.trim() === '' ? null : note,
      });
      if (result.duplicate) {
        setMessage('This matches one already logged, so we kept that one.');
      } else {
        close();
      }
    } catch {
      // The error is not shown or logged: it could echo what was typed.
      setMessage('Could not save. Check the amount and merchant, then try again.');
    } finally {
      setSaving(false);
    }
  }

  const footer = (
    <>
      {message ? (
        <AppText
          variant="body"
          color={colors.headsUp.text}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {message}
        </AppText>
      ) : null}
      <Button
        label="Save"
        onPress={() => void save()}
        disabled={!canSave}
        loading={saving}
        {...(missing.length > 0 ? { accessibilityHint: `Add ${missing.join(', ')} first` } : {})}
      />
    </>
  );

  return (
    <Screen withTabBar={false} footer={footer}>
      <ScreenHeader
        title="Add transaction"
        onBack={close}
        backIcon="close"
        backLabel="Close"
        right={<OnDeviceBadge />}
      />

      <KindPicker value={kind} onChange={setKind} />

      <Card tier="hero" contentStyle={styles.amountCard}>
        <AppText variant="cardLabel">Amount</AppText>
        <View style={styles.amountRow}>
          <AppText variant="amountL" color={colors.ink2}>
            $
          </AppText>
          <TextInput
            value={centsInputText(cents)}
            onChangeText={(text) => setCents(centsFromDigits(text))}
            placeholder="0.00"
            placeholderTextColor={colors.ink2}
            keyboardType="number-pad"
            inputMode="numeric"
            autoFocus
            maxFontSizeMultiplier={maxFontScale.amountL}
            accessibilityLabel="Amount, in dollars"
            accessibilityHint={cents > 0 ? spokenMoney(cents) : 'Type the digits, cents last'}
            style={[type.amountL, styles.amountInput, { color: colors.ink }]}
            testID="add-amount"
          />
        </View>
      </Card>

      <SectionLabel>{kind === 'income' ? 'From' : 'Merchant'}</SectionLabel>
      <Glass variant="light" radius={radius.row} elevation="none" fixed contentStyle={styles.field}>
        <TextInput
          value={merchant}
          onChangeText={setMerchant}
          placeholder={kind === 'income' ? 'e.g. Paycheck' : 'e.g. Corner Cafe'}
          placeholderTextColor={colors.ink2}
          maxLength={MAX_MERCHANT_LENGTH}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          accessibilityLabel={kind === 'income' ? 'From' : 'Merchant'}
          style={[type.body, styles.input, { color: colors.ink }]}
          testID="add-merchant"
        />
      </Glass>

      {needsCategory ? (
        <>
          <SectionLabel>Category</SectionLabel>
          <ListCard>
            <ListRow
              title={categoryId ? categoryMeta(categoryId).name : 'Pick a category'}
              leading={
                categoryId ? (
                  <CategoryTile categoryId={categoryId} />
                ) : (
                  <IconTile icon="dots" tone="neutral" />
                )
              }
              chevron
              onPress={() => setPicking(true)}
              accessibilityLabel={
                categoryId ? `Category: ${categoryMeta(categoryId).name}` : 'Pick a category'
              }
              accessibilityHint="Opens the category list"
            />
          </ListCard>
        </>
      ) : null}

      <SectionLabel>Date</SectionLabel>
      <Glass variant="light" radius={radius.row} elevation="soft" contentStyle={styles.dateRow}>
        <IconButton
          icon="chevronLeft"
          accessibilityLabel="Day before"
          onPress={() => setDaysBack((d) => Math.min(MAX_DAYS_BACK, d + 1))}
          disabled={daysBack >= MAX_DAYS_BACK}
          flat
        />
        <Touchable
          onPress={() => setPickingDay(true)}
          accessibilityRole="button"
          accessibilityLabel={`Date: ${dayLabel}`}
          accessibilityHint="Opens a calendar"
          style={styles.dateButton}
        >
          <AppText
            variant="bodyStrong"
            style={styles.dateText}
            accessibilityLiveRegion="polite"
            testID="add-date"
          >
            {dayLabel}
          </AppText>
        </Touchable>
        {daysBack > 0 ? (
          <IconButton
            icon="chevronRight"
            accessibilityLabel="Day after"
            onPress={() => setDaysBack((d) => Math.max(0, d - 1))}
            flat
          />
        ) : (
          <View style={styles.iconSpacer} />
        )}
      </Glass>

      <SectionLabel>Note (optional)</SectionLabel>
      <Glass variant="light" radius={radius.row} elevation="none" fixed contentStyle={styles.field}>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Add a note"
          placeholderTextColor={colors.ink2}
          maxLength={MAX_NOTE_LENGTH}
          multiline
          accessibilityLabel="Note"
          style={[type.body, styles.input, styles.noteInput, { color: colors.ink }]}
        />
      </Glass>

      <CategoryPickerSheet
        visible={picking}
        selectedId={categoryId}
        onSelect={(id) => {
          setCategoryId(id);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
      <DateSheet
        visible={pickingDay}
        value={day}
        min={addDays(startOfDay(now), -MAX_DAYS_BACK)}
        max={now}
        onSelect={(picked) => {
          setDaysBack(Math.min(MAX_DAYS_BACK, Math.max(0, daysBackTo(picked, now))));
          setPickingDay(false);
        }}
        onClose={() => setPickingDay(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  kinds: { padding: space.xs },
  kindRow: { flexDirection: 'row', gap: space.xs },
  kind: {
    flex: 1,
    minHeight: layout.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
  },
  amountCard: { gap: space.sm },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  amountInput: { flex: 1, minWidth: 0, paddingVertical: space.xs, minHeight: layout.touchTarget },
  field: { paddingHorizontal: space.lg },
  input: { minHeight: layout.rowMinHeight, paddingVertical: space.md },
  noteInput: { textAlignVertical: 'top' },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    padding: space.xs,
  },
  dateButton: {
    flex: 1,
    minHeight: layout.touchTarget,
    justifyContent: 'center',
    borderRadius: radius.button,
  },
  dateText: { textAlign: 'center' },
  iconSpacer: { width: layout.touchTarget, height: layout.touchTarget },
});
