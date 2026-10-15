import { CATEGORIES, type CategoryId } from '@steadily/taxonomy';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import {
  AppText,
  Button,
  CategoryTile,
  Glass,
  Icon,
  RadioRow,
  Screen,
  ScreenHeader,
  SectionLabel,
} from '@/components';
import { useData, useDataSource, useNow } from '@/data';
import { monthRange } from '@/lib/dates';
import { amountInputFromCents, formatMoney, parseAmountInput, spokenMoney } from '@/lib/money';
import { iconSize, layout, radius, space, type, useTheme } from '@/theme';

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

      <Glass variant="strong" radius={radius.card} contentStyle={styles.amountCard}>
        <AppText variant="heading" color={colors.ink2}>
          Amount per month
        </AppText>
        <View style={styles.amountRow}>
          <AppText variant="amountL" color={colors.ink2}>
            $
          </AppText>
          <TextInput
            value={display}
            onChangeText={setAmountText}
            placeholder="0"
            placeholderTextColor={colors.ink2}
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
      </Glass>

      <SectionLabel>Applies to</SectionLabel>
      <Glass variant="light" radius={radius.cardSmall} contentStyle={styles.list}>
        <View accessibilityRole="radiogroup">
          <RadioRow
            label="Whole month"
            description="Everything you spend"
            selected={target === null}
            onPress={() => pick(null)}
            leading={
              <View style={[styles.overallTile, { backgroundColor: colors.accentTint }]}>
                <Icon name="budgets" size={iconSize.md} color={colors.accentInk} />
              </View>
            }
          />
          {CATEGORIES.map((c) => (
            <View key={c.id} style={[styles.divider, { borderTopColor: colors.hairline }]}>
              <RadioRow
                label={c.name}
                selected={target === c.id}
                onPress={() => pick(c.id)}
                leading={<CategoryTile categoryId={c.id} icon={c.icon} />}
              />
            </View>
          ))}
        </View>
      </Glass>

      <Button label="Save budget" onPress={() => void save()} disabled={!canSave} />
      {existing ? (
        <Button label="Remove budget" variant="neutralTint" onPress={() => void remove()} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  amountCard: { padding: layout.cardPadding + 2, gap: space.sm },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  amountInput: { flex: 1, paddingVertical: space.xs, minHeight: layout.touchTarget },
  list: { paddingHorizontal: space.lg, paddingVertical: space.xs },
  divider: { borderTopWidth: StyleSheet.hairlineWidth * 2 },
  overallTile: {
    width: 40,
    height: 40,
    borderRadius: radius.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
