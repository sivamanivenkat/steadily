import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatMoney, spokenMoney } from '@/lib/money';
import { space, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Card } from './Card';
import { OnDeviceBadge } from './OnDeviceBadge';

type SafeToSpendCardProps = {
  amountCents: number;
  /** e.g. "Oct 31" */
  untilLabel: string;
  perDayCents: number;
  /** Where the number comes from when it is not the overall budget. */
  basisLabel?: string;
  /** Label over the footer, e.g. "This month". */
  footerLabel?: string;
  /** Under a hairline at the bottom of the card, e.g. the month's pace bar. */
  footer?: ReactNode;
};

/**
 * The headline number: what is safe to spend until the end of the period. Hero tier (strong
 * glass, raised); an optional footer keeps the month's pace in the same card, so Home has one hero
 * instead of two stacked cards.
 */
export function SafeToSpendCard({
  amountCents,
  untilLabel,
  perDayCents,
  basisLabel,
  footerLabel,
  footer,
}: SafeToSpendCardProps) {
  const { colors } = useTheme();
  const perDay = formatMoney(perDayCents, { cents: 'auto' });

  return (
    <Card tier="hero" contentStyle={styles.content}>
      <View style={styles.header}>
        <AppText variant="cardLabel">Safe to spend</AppText>
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
        tabular
        accessibilityLabel={`Until ${untilLabel}, about ${spokenMoney(perDayCents)} a day`}
      >
        until {untilLabel} · about {perDay} a day
      </AppText>
      {basisLabel ? (
        <AppText variant="caption" color={colors.ink2}>
          {basisLabel}
        </AppText>
      ) : null}
      {footer ? (
        <View style={[styles.footer, { borderTopColor: colors.hairline }]}>
          {footerLabel ? <AppText variant="cardLabel">{footerLabel}</AppText> : null}
          {footer}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.xs },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    marginBottom: space.xs,
  },
  footer: {
    gap: space.md,
    marginTop: space.lg,
    paddingTop: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
  },
});
