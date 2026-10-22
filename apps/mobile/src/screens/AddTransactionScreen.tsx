import { FALLBACK_CATEGORY_ID, type CategoryId } from '@steadily/taxonomy';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import {
  AppText,
  Button,
  CategoryPickerSheet,
  CategoryTile,
  Glass,
  Icon,
  IconButton,
  OnDeviceBadge,
  Screen,
  ScreenHeader,
  SectionLabel,
} from '@/components';
import { categoryMeta } from '@/components/CategoryTile';
import { useDataSource, useNow } from '@/data';
import { MAX_MERCHANT_LENGTH, MAX_NOTE_LENGTH } from '@/data/manual';
import type { ManualKind } from '@/data/types';
import { addDays, dayHeading, formatShortDate, startOfDay } from '@/lib/dates';
import { centsFromDigits, centsInputText, spokenMoney } from '@/lib/money';
import { iconSize, layout, radius, space, type, useTheme } from '@/theme';

const KINDS: readonly { value: ManualKind; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'refund', label: 'Refund' },
];

/** How far back the day stepper goes. */
const MAX_DAYS_BACK = 365;

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

function KindPicker({
  value,
  onChange,
}: {
  value: ManualKind;
  onChange: (kind: ManualKind) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.kinds} accessibilityRole="radiogroup" accessibilityLabel="Type">
      {KINDS.map((kind) => {
        const selected = kind.value === value;
        return (
          <Pressable
            key={kind.value}
            onPress={() => onChange(kind.value)}
            accessibilityRole="radio"
            accessibilityLabel={kind.label}
            accessibilityState={{ checked: selected }}
            style={({ pressed }) => [styles.kindWrap, pressed && styles.pressed]}
          >
            <Glass
              variant="light"
              radius={radius.pill}
              shadow={false}
              fixed
              contentStyle={[
                styles.kind,
                { borderColor: selected ? colors.ink : colors.solidBorder },
              ]}
            >
              {selected ? <Icon name="check" size={iconSize.sm} color={colors.ink} /> : null}
              <AppText variant="bodyStrong">{kind.label}</AppText>
            </Glass>
          </Pressable>
        );
      })}
    </View>
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

  return (
    <Screen withTabBar={false}>
      <ScreenHeader
        title="Add transaction"
        onBack={close}
        backIcon="close"
        backLabel="Close"
        right={<OnDeviceBadge />}
      />

      <KindPicker value={kind} onChange={setKind} />

      <Glass variant="strong" radius={radius.card} contentStyle={styles.amountCard}>
        <AppText variant="heading" color={colors.ink2}>
          Amount
        </AppText>
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
            accessibilityLabel="Amount, in dollars"
            accessibilityHint={cents > 0 ? spokenMoney(cents) : 'Type the digits, cents last'}
            style={[type.amountL, styles.amountInput, { color: colors.ink }]}
            testID="add-amount"
          />
        </View>
      </Glass>

      <SectionLabel>{kind === 'income' ? 'From' : 'Merchant'}</SectionLabel>
      <Glass
        variant="light"
        radius={radius.button}
        shadow={false}
        fixed
        contentStyle={styles.field}
      >
        <TextInput
          value={merchant}
          onChangeText={setMerchant}
          placeholder={kind === 'income' ? 'e.g. Paycheck' : 'e.g. Corner Cafe'}
          placeholderTextColor={colors.ink2}
          maxLength={MAX_MERCHANT_LENGTH}
          autoCapitalize="words"
          autoCorrect={false}
          accessibilityLabel={kind === 'income' ? 'From' : 'Merchant'}
          style={[type.body, styles.input, { color: colors.ink }]}
          testID="add-merchant"
        />
      </Glass>

      {needsCategory ? (
        <>
          <SectionLabel>Category</SectionLabel>
          <Pressable
            onPress={() => setPicking(true)}
            accessibilityRole="button"
            accessibilityLabel={
              categoryId ? `Category: ${categoryMeta(categoryId).name}` : 'Pick a category'
            }
            accessibilityHint="Opens the category list"
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Glass variant="light" radius={radius.row} contentStyle={styles.pickRow}>
              {categoryId ? (
                <CategoryTile categoryId={categoryId} />
              ) : (
                <View style={[styles.emptyTile, { backgroundColor: colors.neutralTint }]}>
                  <Icon name="dots" size={iconSize.md} color={colors.ink2} />
                </View>
              )}
              <AppText variant="bodyStrong" style={styles.flex}>
                {categoryId ? categoryMeta(categoryId).name : 'Pick a category'}
              </AppText>
              <Icon name="chevronRight" size={iconSize.md} color={colors.ink2} />
            </Glass>
          </Pressable>
        </>
      ) : null}

      <SectionLabel>Date</SectionLabel>
      <Glass variant="light" radius={radius.row} contentStyle={styles.dateRow}>
        <IconButton
          icon="chevronLeft"
          accessibilityLabel="Day before"
          onPress={() => setDaysBack((d) => Math.min(MAX_DAYS_BACK, d + 1))}
        />
        <AppText
          variant="bodyStrong"
          style={styles.dateText}
          accessibilityLiveRegion="polite"
          testID="add-date"
        >
          {dayLabel}
        </AppText>
        {daysBack > 0 ? (
          <IconButton
            icon="chevronRight"
            accessibilityLabel="Day after"
            onPress={() => setDaysBack((d) => Math.max(0, d - 1))}
          />
        ) : (
          <View style={styles.iconSpacer} />
        )}
      </Glass>

      <SectionLabel>Note (optional)</SectionLabel>
      <Glass
        variant="light"
        radius={radius.button}
        shadow={false}
        fixed
        contentStyle={styles.field}
      >
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Add a note"
          placeholderTextColor={colors.ink2}
          maxLength={MAX_NOTE_LENGTH}
          multiline
          accessibilityLabel="Note"
          style={[type.body, styles.input, { color: colors.ink }]}
        />
      </Glass>

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

      <Button label="Save" onPress={() => void save()} disabled={!canSave} />

      <CategoryPickerSheet
        visible={picking}
        selectedId={categoryId}
        onSelect={(id) => {
          setCategoryId(id);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  kindWrap: { flexGrow: 1 },
  kind: {
    minHeight: layout.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs + 2,
    paddingHorizontal: space.lg,
    borderWidth: 2,
  },
  amountCard: { padding: layout.cardPadding + 2, gap: space.sm },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  amountInput: { flex: 1, paddingVertical: space.xs, minHeight: layout.touchTarget },
  field: { paddingHorizontal: space.lg },
  input: { minHeight: layout.touchTarget, paddingVertical: space.sm },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: layout.touchTarget + space.lg,
  },
  emptyTile: {
    width: 40,
    height: 40,
    borderRadius: radius.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
  },
  dateText: { flex: 1, textAlign: 'center' },
  iconSpacer: { width: layout.touchTarget, height: layout.touchTarget },
});
