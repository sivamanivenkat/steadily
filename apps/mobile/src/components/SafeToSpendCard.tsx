import { StyleSheet, View } from 'react-native';

import { formatMoney, spokenMoney } from '@/lib/money';
import { layout, radius, space, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Glass } from './Glass';
import { OnDeviceBadge } from './OnDeviceBadge';

type SafeToSpendCardProps = {
  amountCents: number;
  /** e.g. "Oct 31" */
  untilLabel: string;
  perDayCents: number;
};

/** The headline number: what is safe to spend until the end of the period. */
export function SafeToSpendCard({ amountCents, untilLabel, perDayCents }: SafeToSpendCardProps) {
  const { colors } = useTheme();
  const perDay = formatMoney(perDayCents, { cents: 'auto' });

  return (
    <Glass variant="strong" radius={radius.card} contentStyle={styles.content}>
      <View style={styles.header}>
        <AppText variant="heading" color={colors.ink2}>
          Safe to spend
        </AppText>
        <OnDeviceBadge />
      </View>
      <AppText
        variant="display"
        accessibilityLabel={`Safe to spend: ${spokenMoney(amountCents)}`}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {formatMoney(amountCents, { cents: 'auto' })}
      </AppText>
      <AppText
        variant="caption"
        color={colors.ink2}
        accessibilityLabel={`Until ${untilLabel}, about ${spokenMoney(perDayCents)} a day`}
      >
        until {untilLabel} · about {perDay} a day
      </AppText>
    </Glass>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: layout.cardPadding + 2,
    gap: space.xs,
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    marginBottom: space.xs,
  },
});
