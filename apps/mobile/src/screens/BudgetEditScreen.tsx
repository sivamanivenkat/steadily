import { CATEGORIES, type CategoryId } from '@steadily/taxonomy';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import {
  AppText,
  Button,
  Card,
  CategoryTile,
  ConfirmSheet,
  IconTile,
  ListCard,
  RadioRow,
  Screen,
  ScreenHeader,
  SectionLabel,
} from '@/components';
import { useData, useDataSource, useNow } from '@/data';
import { monthRange } from '@/lib/dates';
import { amountInputFromCents, formatMoney, parseAmountInput, spokenMoney } from '@/lib/money';
import { layout, maxFontScale, space, type, useTheme } from '@/theme';

/** `undefined` = nothing picked yet; `null` = the overall monthly budget. */
type Target = CategoryId | null | undefined;

type BudgetEditScreenProps = { initialCategoryId?: CategoryId | null };

/** "Set a budget": amount with currency formatting, then the category it applies to. */
export function BudgetEditScreen({ initialCategoryId }: BudgetEditScreenProps) {
  const router = useRouter();
  const source = useDataSource();
  const { colors } = useTheme();
  const now = useNow();
  const { data: rows } = useData((s) => s.listBudgets(monthRange(now)), [now]);

  const [target, setTarget] = useState<Target>(initialCategoryId);
  const [amountText, setAmountText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const existing =
    target === undefined ? undefined : rows?.find((r) => r.budget.categoryId === target);
  // Until the user types, show the existing amount for the picked category.
  const shownText =
    amountText ?? (existing ? amountInputFromCents(existing.budget.amountMinor) : '');
  const { display, cents } = parseAmountInput(shownText);
  const canSave = target !== undefined && cents > 0 && !saving;

  const pick = (next: CategoryId | null) => {
    setTarget(next);
    setAmountText(null);
  };

  async function save() {
    if (target === undefined || cents <= 0) return;
    setSaving(true);
    try {
      await source.setBudget({ categoryId: target, amountMinor: cents });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setConfirmingRemove(false);
    if (!existing) return;
    await source.deleteBudget(existing.budget.id);
    router.back();
  }

  const spentLine = existing
    ? `Spent so far this month: ${formatMoney(existing.spentMinor)}`
    : 'Monthly amount. You can change it any time.';

  return (
    <Screen withTabBar={false}>
      <ScreenHeader
        title={existing ? 'Edit budget' : 'Set a budget'}
        onBack={() => router.back()}
        backIcon="close"
        backLabel="Close"
      />

      <Card tier="hero" contentStyle={styles.amountCard}>
        <AppText variant="heading" color={colors.ink2}>
          Amount per month
        </AppText>
        <View style={styles.amountRow}>
          <AppText
            variant="amountL"
            color={colors.ink2}
            maxFontSizeMultiplier={maxFontScale.display}
          >
            $
          </AppText>
          <TextInput
            value={display}
            onChangeText={setAmountText}
            placeholder="0"
            placeholderTextColor={colors.ink2}
            maxFontSizeMultiplier={maxFontScale.display}
            keyboardType="decimal-pad"
            inputMode="decimal"
            accessibilityLabel="Amount per month, in dollars"
            accessibilityHint={cents > 0 ? spokenMoney(cents) : undefined}
            style={[type.amountL, styles.amountInput, { color: colors.ink }]}
            testID="budget-amount"
          />
        </View>
        <AppText variant="caption" color={colors.ink2}>
          {spentLine}
        </AppText>
      </Card>

      <SectionLabel>Applies to</SectionLabel>
      <ListCard accessibilityRole="radiogroup" accessibilityLabel="Applies to">
        <RadioRow
          label="Whole month"
          description="Everything you spend"
          selected={target === null}
          onPress={() => pick(null)}
          leading={<IconTile icon="budgets" tone="accent" />}
        />
        {CATEGORIES.map((c) => (
          <RadioRow
            key={c.id}
            label={c.name}
            selected={target === c.id}
            onPress={() => pick(c.id)}
            leading={<CategoryTile categoryId={c.id} icon={c.icon} />}
          />
        ))}
      </ListCard>

      <View style={styles.actions}>
        <Button
          label="Save budget"
          onPress={() => void save()}
          disabled={!canSave}
          loading={saving}
        />
        {existing ? (
          <Button
            label="Remove budget"
            variant="link"
            accessibilityHint="Asks before removing"
            onPress={() => setConfirmingRemove(true)}
          />
        ) : null}
      </View>

      <ConfirmSheet
        visible={confirmingRemove}
        title={target === null ? 'Remove the monthly budget?' : 'Remove this budget?'}
        body={[
          target === null
            ? 'Safe to spend needs a monthly budget, so it will be hidden until you set one again.'
            : 'Your transactions stay as they are. Only the limit for this category goes away.',
        ]}
        confirmLabel="Remove"
        destructive
        cancelLabel="Keep budget"
        onConfirm={() => void remove()}
        onCancel={() => setConfirmingRemove(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  amountCard: { gap: space.sm },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  amountInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: space.xs,
    minHeight: layout.touchTarget,
  },
  actions: { gap: space.xs, marginTop: space.sm },
});
