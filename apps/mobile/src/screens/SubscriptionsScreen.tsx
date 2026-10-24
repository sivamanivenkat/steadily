import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  AppText,
  BottomSheet,
  Button,
  Card,
  CategoryTile,
  EmptyState,
  Glass,
  ListCard,
  OnDeviceBadge,
  Screen,
  ScreenHeader,
  SectionLabel,
  StatusPill,
  Touchable,
} from '@/components';
import { useData, useDataSource, useNow } from '@/data';
import type { Subscription, SubscriptionSummary } from '@/data/types';
import { formatShortDate } from '@/lib/dates';
import { formatMoney, spokenMoney } from '@/lib/money';
import {
  CADENCE_LABEL,
  CADENCE_SPOKEN,
  CADENCE_SUFFIX,
  nextDueDate,
  priceChange,
  sortByNextDue,
  subscriptionsMonthlyTotal,
  type PriceChange,
} from '@/lib/subscriptions';
import { layout, radius, space, useTheme } from '@/theme';

const money = (cents: number) => formatMoney(cents, { cents: 'auto' });

function changeLabel(change: PriceChange): { text: string; spoken: string } {
  const word = change.direction === 'up' ? 'up' : 'down';
  return {
    text: `Price ${word} ${money(change.diffMinor)}`,
    spoken: `price ${word} ${spokenMoney(change.diffMinor)}`,
  };
}

function PriceBadge({ change }: { change: PriceChange }) {
  return (
    <StatusPill
      label={changeLabel(change).text}
      tone={change.direction === 'up' ? 'headsUp' : 'neutral'}
      icon={change.direction === 'up' ? 'arrowUp' : 'arrowDown'}
    />
  );
}

function SubscriptionRow({
  summary,
  now,
  onPress,
}: {
  summary: SubscriptionSummary;
  now: Date;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const sub = summary.subscription;
  const due = formatShortDate(nextDueDate(sub, now));
  const change = priceChange(summary);
  const label = [
    sub.merchantName,
    `${spokenMoney(sub.amountMinor)} ${CADENCE_SPOKEN[sub.cadence]}`,
    `next charge ${due}`,
    change ? changeLabel(change).spoken : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Touchable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Shows recent charges"
      style={styles.row}
    >
      <CategoryTile categoryId={sub.categoryId} />
      <View style={styles.rowText}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {sub.merchantName}
        </AppText>
        <AppText variant="caption" color={colors.ink2}>
          {CADENCE_LABEL[sub.cadence]} · next {due}
        </AppText>
        {change ? <PriceBadge change={change} /> : null}
      </View>
      <AppText variant="amount" style={styles.amount}>
        {formatMoney(sub.amountMinor)}
        <AppText variant="caption" color={colors.ink2}>
          {CADENCE_SUFFIX[sub.cadence]}
        </AppText>
      </AppText>
    </Touchable>
  );
}

/** Bottom sheet with a subscription's recent charges and the "Not a subscription" action. */
function SubscriptionSheet({
  summary,
  now,
  onDismissSubscription,
  onClose,
}: {
  summary: SubscriptionSummary | null;
  now: Date;
  onDismissSubscription: (sub: Subscription) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const id = summary?.subscription.id ?? null;
  const { data: charges } = useData(
    (source) => (id ? source.listSubscriptionCharges(id) : Promise.resolve([])),
    [id],
  );
  const sub = summary?.subscription;
  const change = summary ? priceChange(summary) : null;

  return (
    <BottomSheet
      visible={summary !== null}
      onClose={onClose}
      maxHeight="90%"
      contentStyle={styles.sheetBody}
    >
      {sub ? (
        <ScrollView contentContainerStyle={styles.sheetContent}>
          <View style={styles.sheetHeader}>
            <CategoryTile categoryId={sub.categoryId} />
            <AppText variant="heading" accessibilityRole="header" style={styles.flex}>
              {sub.merchantName}
            </AppText>
          </View>
          <AppText
            variant="amountL"
            accessibilityLabel={`${spokenMoney(sub.amountMinor)} ${CADENCE_SPOKEN[sub.cadence]}`}
          >
            {formatMoney(sub.amountMinor)}
            <AppText variant="body" color={colors.ink2}>
              {CADENCE_SUFFIX[sub.cadence]}
            </AppText>
          </AppText>
          <AppText variant="caption" color={colors.ink2}>
            {CADENCE_LABEL[sub.cadence]} · next charge {formatShortDate(nextDueDate(sub, now))}
          </AppText>
          {change ? (
            <View
              accessible
              accessibilityLabel={`Was ${spokenMoney(change.previousMinor)}, now ${spokenMoney(sub.amountMinor)}`}
              style={styles.changeLine}
            >
              <PriceBadge change={change} />
              <AppText variant="caption" color={colors.ink2}>
                Was {formatMoney(change.previousMinor)}, now {formatMoney(sub.amountMinor)}
              </AppText>
            </View>
          ) : null}

          <SectionLabel>Recent charges</SectionLabel>
          {charges === undefined ? (
            <AppText variant="caption" color={colors.ink2}>
              Loading charges…
            </AppText>
          ) : charges.length === 0 ? (
            <AppText variant="caption" color={colors.ink2}>
              No charges logged on this phone yet.
            </AppText>
          ) : (
            <View>
              {charges.map((tx, i) => {
                const date = formatShortDate(new Date(tx.occurredAt));
                return (
                  <View
                    key={tx.id}
                    accessible
                    accessibilityLabel={`${date}: ${spokenMoney(tx.amountMinor)}`}
                    style={[
                      styles.chargeRow,
                      i > 0 && [styles.divider, { borderTopColor: colors.hairline }],
                    ]}
                  >
                    <AppText variant="body" style={styles.flex}>
                      {date}
                    </AppText>
                    <AppText variant="amount">{formatMoney(tx.amountMinor)}</AppText>
                  </View>
                );
              })}
            </View>
          )}

          <Button
            label="Not a subscription"
            variant="neutralTint"
            accessibilityHint="Stops counting it in subscriptions and safe to spend"
            onPress={() => onDismissSubscription(sub)}
          />
          <Button label="Close" variant="accentTint" onPress={onClose} />
        </ScrollView>
      ) : null}
    </BottomSheet>
  );
}

/** Subscriptions: repeating charges found on this phone, what they cost a month, what's next. */
export function SubscriptionsScreen() {
  const router = useRouter();
  const source = useDataSource();
  const { colors } = useTheme();
  const now = useNow();
  const { data, error } = useData((s) => s.listSubscriptions());
  const [openId, setOpenId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Subscription | null>(null);

  const subscriptions = data ? sortByNextDue(data, now) : undefined;
  const open = subscriptions?.find((s) => s.subscription.id === openId) ?? null;
  const monthly = subscriptions
    ? subscriptionsMonthlyTotal(subscriptions.map((s) => s.subscription))
    : 0;
  const count = subscriptions?.length ?? 0;

  const dismiss = (sub: Subscription) => {
    setOpenId(null);
    setDismissed(sub);
    void source.setSubscriptionDismissed(sub.id, true);
  };
  const undo = () => {
    if (!dismissed) return;
    void source.setSubscriptionDismissed(dismissed.id, false);
    setDismissed(null);
  };

  return (
    <Screen withTabBar={false}>
      <ScreenHeader title="Subscriptions" onBack={() => router.back()} />

      {dismissed ? (
        <Glass variant="strong" radius={radius.row} contentStyle={styles.undoBar}>
          <AppText
            variant="body"
            style={styles.flex}
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
          >
            {dismissed.merchantName} is no longer counted as a subscription.
          </AppText>
          <Button
            label="Undo"
            variant="accentTint"
            accessibilityLabel={`Undo, count ${dismissed.merchantName} as a subscription again`}
            onPress={undo}
          />
        </Glass>
      ) : null}

      {subscriptions === undefined ? (
        <Card>
          <AppText variant="body" color={colors.ink2} accessibilityLiveRegion="polite">
            {error !== undefined
              ? 'Could not load subscriptions. Try again in a moment.'
              : 'Looking for repeating charges…'}
          </AppText>
        </Card>
      ) : count === 0 ? (
        <EmptyState
          tier="hero"
          icon="repeat"
          title="No subscriptions found yet"
          body="When the same charge repeats, like a streaming plan or a gym, Steadily lists it here with the next due date."
        />
      ) : (
        <>
          <Card tier="hero" contentStyle={styles.card}>
            <View style={styles.cardHeader}>
              <AppText variant="heading" color={colors.ink2}>
                Every month
              </AppText>
              <OnDeviceBadge />
            </View>
            <AppText
              variant="amountL"
              accessibilityLabel={`About ${spokenMoney(monthly)} a month for ${count} ${count === 1 ? 'subscription' : 'subscriptions'}`}
            >
              {money(monthly)}
            </AppText>
            <AppText variant="caption" color={colors.ink2}>
              {`About this much a month for ${count} ${count === 1 ? 'subscription' : 'subscriptions'}, spotted from repeating charges on this phone.`}
            </AppText>
          </Card>

          <SectionLabel>Next up first</SectionLabel>
          <ListCard>
            {subscriptions.map((summary) => (
              <SubscriptionRow
                key={summary.subscription.id}
                summary={summary}
                now={now}
                onPress={() => setOpenId(summary.subscription.id)}
              />
            ))}
          </ListCard>
        </>
      )}

      <SubscriptionSheet
        summary={open}
        now={now}
        onDismissSubscription={dismiss}
        onClose={() => setOpenId(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: space.sm },
  cardHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  undoBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth * 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.rowMinHeight,
    paddingVertical: layout.rowPaddingVertical,
  },
  rowText: { flex: 1, minWidth: 0, gap: space.xxs },
  amount: { flexShrink: 0, textAlign: 'right' },
  // The sheet scrolls its own content edge to edge; the scroll view carries the padding.
  sheetBody: { paddingHorizontal: 0 },
  sheetContent: {
    gap: space.md,
    paddingTop: space.xs,
    paddingHorizontal: layout.screenPadding,
    paddingBottom: space.xs,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  changeLine: { gap: space.xs },
  chargeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: layout.touchTarget,
    paddingVertical: space.xs,
  },
});
