import {
  FALLBACK_CATEGORY_ID,
  isBuiltInCategoryId,
  type BuiltInCategoryId,
  type CategoryId,
} from '@steadily/taxonomy';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import {
  AppText,
  Button,
  CategoryChip,
  CategoryPickerSheet,
  EntranceView,
  Glass,
  Icon,
  P2PPrompt,
  ReviewCard,
  Screen,
  ScreenHeader,
  ToggleRow,
} from '@/components';
import { categoryMeta } from '@/components/CategoryTile';
import { isP2PIssuer, issuerName, useData, useDataSource } from '@/data';
import type { P2PPurpose, ReviewItem } from '@/data/types';
import { dateTimeLabel } from '@/lib/dates';
import { iconSize, layout, radius, space, useTheme } from '@/theme';

/** P2P purposes that map straight to a category; the others ask what the money was for. */
const P2P_DIRECT: Partial<Record<P2PPurpose, BuiltInCategoryId>> = {
  rent: 'housing.rent_mortgage',
  gift: 'gifts.general',
};

function announce(message: string) {
  try {
    AccessibilityInfo.announceForAccessibility(message);
  } catch {
    // Screen reader announcements are best-effort.
  }
}

/** Up to three distinct guesses, best first, padded with the current category and "Other". */
export function topCategories(item: ReviewItem): BuiltInCategoryId[] {
  const current = item.transaction.categoryId;
  const pool: BuiltInCategoryId[] = [...item.suggestedCategoryIds];
  if (isBuiltInCategoryId(current)) pool.push(current);
  pool.push(FALLBACK_CATEGORY_ID);
  return [...new Set(pool)].slice(0, 3);
}

function metaLine(item: ReviewItem): string {
  const tx = item.transaction;
  const where = tx.accountLast4 ? `Card ending ${tx.accountLast4}` : issuerName(tx.issuerId);
  return [dateTimeLabel(new Date(tx.occurredAt)), where].filter(Boolean).join(' · ');
}

function ReviewItemCard({ item, behind }: { item: ReviewItem; behind: number }) {
  const source = useDataSource();
  const { colors } = useTheme();
  const tx = item.transaction;
  const merchant = tx.merchantName ?? tx.merchantRaw ?? 'Unknown merchant';
  const p2p = isP2PIssuer(tx.issuerId);

  const [p2pStep, setP2PStep] = useState<'purpose' | 'category'>('purpose');
  const [moreOpen, setMoreOpen] = useState(false);
  const [remember, setRemember] = useState(true);
  const busy = useRef(false);

  async function run(action: () => Promise<void>, message: string) {
    if (busy.current) return;
    busy.current = true;
    try {
      await action();
      announce(message);
    } finally {
      busy.current = false;
    }
  }

  const choose = (categoryId: CategoryId) => {
    setMoreOpen(false);
    const name = categoryMeta(categoryId).name;
    // People payments are one-offs: never turn them into a merchant rule.
    return run(
      () => source.confirmCategory(tx.id, categoryId, !p2p && remember),
      `Saved as ${name}.`,
    );
  };

  const notExpense = () => run(() => source.markNotExpense(tx.id), 'Marked as not an expense.');

  const onPurpose = (purpose: P2PPurpose) => {
    const direct = P2P_DIRECT[purpose];
    if (direct) void choose(direct);
    else setP2PStep('category');
  };

  const chips = (
    <View style={styles.chips}>
      {topCategories(item).map((id) => (
        <CategoryChip key={id} categoryId={id} onPress={() => void choose(id)} />
      ))}
      <CategoryChip kind="more" onPress={() => setMoreOpen(true)} />
    </View>
  );

  let body;
  if (p2p && p2pStep === 'purpose') {
    body = <P2PPrompt onChoose={onPurpose} />;
  } else if (p2p) {
    body = (
      <View style={styles.section}>
        <AppText variant="heading">What was it for?</AppText>
        {chips}
        <Button
          label="Back"
          variant="link"
          onPress={() => setP2PStep('purpose')}
          accessibilityLabel="Back to payment purpose"
          style={styles.alignStart}
        />
      </View>
    );
  } else {
    body = (
      <View style={styles.section}>
        {chips}
        <ToggleRow
          label={`Always use for ${merchant}`}
          description="Also files other charges from here the same way"
          value={remember}
          onValueChange={setRemember}
        />
      </View>
    );
  }

  return (
    <>
      <ReviewCard
        headsUp={p2p ? 'Payment to a person' : 'Not sure. Pick a category'}
        merchant={merchant}
        amountCents={tx.amountMinor}
        meta={metaLine(item)}
        behind={behind}
      >
        {body}
        <View style={[styles.actions, { borderTopColor: colors.hairline }]}>
          <Button
            label="Split across categories"
            variant="accentTint"
            disabled
            accessibilityHint="Coming soon"
            onPress={() => {}}
            style={styles.action}
          />
          <Button
            label="Not an expense"
            variant="neutralTint"
            onPress={() => void notExpense()}
            style={styles.action}
          />
        </View>
      </ReviewCard>
      <CategoryPickerSheet
        visible={moreOpen}
        selectedId={null}
        onSelect={(id) => void choose(id)}
        onClose={() => setMoreOpen(false)}
      />
    </>
  );
}

function AllCaughtUp({ onDone }: { onDone: () => void }) {
  const { colors } = useTheme();
  return (
    <Glass variant="strong" radius={radius.card} contentStyle={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.status.onTrack.bg }]}>
        <Icon name="check" size={iconSize.lg} color={colors.status.onTrack.text} />
      </View>
      <AppText variant="heading" accessibilityRole="header">
        All caught up
      </AppText>
      <AppText variant="body" color={colors.ink2} style={styles.center}>
        New transactions that need a look will show up here.
      </AppText>
      <Button label="Back to Home" variant="secondary" onPress={onDone} />
    </Glass>
  );
}

/** The review queue (D-009, D-015): one card at a time, a tap to file each. */
export function ReviewScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { data: items } = useData((source) => source.listNeedsReview());

  const current = items?.[0];
  const subtitle = items && items.length > 0 ? `${items.length} left` : undefined;

  return (
    <Screen withTabBar={false}>
      <ScreenHeader title="To review" subtitle={subtitle} onBack={() => router.back()} />

      {items === undefined ? null : current ? (
        <EntranceView key={current.transaction.id}>
          <ReviewItemCard item={current} behind={items.length - 1} />
        </EntranceView>
      ) : (
        <AllCaughtUp onDone={() => router.back()} />
      )}

      {current ? (
        <View style={styles.footer}>
          <Icon name="lock" size={iconSize.sm} color={colors.ink2} />
          <AppText variant="caption" color={colors.ink2} style={styles.footerText}>
            Your choice teaches Steadily on this phone
          </AppText>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  alignStart: { alignSelf: 'flex-start' },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
  },
  action: { flexGrow: 1, flexBasis: '45%' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs + 2,
    marginTop: space.sm,
  },
  footerText: { flexShrink: 1, textAlign: 'center' },
  empty: {
    padding: layout.cardPadding + 4,
    alignItems: 'center',
    gap: space.md,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { textAlign: 'center' },
});
