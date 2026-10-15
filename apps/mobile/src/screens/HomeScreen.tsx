import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  AppText,
  Glass,
  Icon,
  IconButton,
  PaceBar,
  SafeToSpendCard,
  Screen,
  TransactionRow,
} from '@/components';
import { homeFixture } from '@/fixtures/home';
import { iconSize, layout, radius, space, useTheme } from '@/theme';

function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const dateFormat = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

export function HomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const data = homeFixture;

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <AppText variant="caption" color={colors.ink2}>
            {dateFormat.format(data.today)}
          </AppText>
          <AppText variant="title" accessibilityRole="header">
            {greetingFor(data.today)}
          </AppText>
        </View>
        <IconButton
          icon="settings"
          accessibilityLabel="Settings"
          onPress={() => router.push('/settings')}
        />
      </View>

      <SafeToSpendCard {...data.safeToSpend} />

      <Glass variant="light" radius={radius.cardSmall} contentStyle={styles.card}>
        <AppText variant="heading">This month</AppText>
        <PaceBar {...data.pace} />
      </Glass>

      <Pressable
        onPress={() => router.navigate('/activity')}
        accessibilityRole="button"
        accessibilityLabel={`${data.toReviewCount} transactions to review`}
        accessibilityHint="Opens Activity"
        style={({ pressed }) => pressed && styles.pressed}
      >
        <Glass variant="light" radius={radius.row} contentStyle={styles.reviewRow}>
          <View style={[styles.reviewIcon, { backgroundColor: colors.headsUp.bg }]}>
            <Icon name="inbox" size={iconSize.md} color={colors.headsUp.text} />
          </View>
          <View style={styles.reviewText}>
            <AppText variant="bodyStrong">{data.toReviewCount} to review</AppText>
            <AppText variant="caption" color={colors.ink2}>
              Confirm categories in a tap
            </AppText>
          </View>
          <Icon name="chevronRight" size={iconSize.md} color={colors.ink2} />
        </Glass>
      </Pressable>

      <AppText
        variant="label"
        color={colors.ink2}
        accessibilityRole="header"
        style={styles.section}
      >
        Recent
      </AppText>
      <Glass variant="light" radius={radius.cardSmall} contentStyle={styles.list}>
        {data.recent.map((tx, i) => (
          <View key={tx.id} style={i > 0 && [styles.divider, { borderTopColor: colors.hairline }]}>
            <TransactionRow
              merchant={tx.merchant}
              amountCents={tx.amountCents}
              categoryId={tx.categoryId}
              timeLabel={tx.timeLabel}
              {...('badge' in tx ? { badge: tx.badge } : {})}
            />
          </View>
        ))}
      </Glass>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.xs,
  },
  headerText: { flex: 1, gap: 2 },
  card: { padding: layout.cardPadding, gap: space.md },
  pressed: { opacity: 0.7 },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: layout.touchTarget + space.lg,
  },
  reviewIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewText: { flex: 1, gap: 2 },
  section: { marginTop: space.sm },
  list: { paddingHorizontal: space.lg, paddingVertical: space.xs },
  divider: { borderTopWidth: StyleSheet.hairlineWidth * 2 },
});
