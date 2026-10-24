import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatMoney, spokenMoney } from '@/lib/money';
import { cardTier, space, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Glass } from './Glass';
import { StatusPill } from './StatusPill';

/** How far each peek layer shows below the card in front of it. */
const PEEK_STEP = 10;
/** Horizontal inset per peek layer. */
const PEEK_INSET = 14;
const MAX_PEEK_LAYERS = 2;
/** Opacity lost per peek layer. */
const PEEK_FADE = 0.2;

type ReviewCardProps = {
  /** Heads-up line, e.g. "Not sure. Pick a category". */
  headsUp: string;
  merchant: string;
  amountCents: number;
  /** "Oct 14 · 3:12 PM · Card ending 4821" */
  meta: string;
  /** Cards still waiting behind this one; drawn as peek layers (up to 2). */
  behind: number;
  /** Chips and actions. */
  children: ReactNode;
};

/**
 * Review queue card (steadily-ui "ReviewCard"): strong glass, radius 28, with stacked "peek"
 * layers underneath that show how many more are waiting.
 */
export function ReviewCard({
  headsUp,
  merchant,
  amountCents,
  meta,
  behind,
  children,
}: ReviewCardProps) {
  const { colors } = useTheme();
  const layers = Math.min(MAX_PEEK_LAYERS, Math.max(0, behind));

  return (
    <View style={{ paddingBottom: layers * PEEK_STEP }}>
      {Array.from({ length: layers }, (_, i) => layers - i).map((depth) => (
        <Glass
          key={depth}
          variant="light"
          radius={cardTier.hero.radius}
          shadow={false}
          // Translucent tint on Android too: a solid surface at reduced opacity reads as grey.
          fixed
          style={[
            styles.peek,
            {
              left: depth * PEEK_INSET,
              right: depth * PEEK_INSET,
              bottom: (layers - depth) * PEEK_STEP,
              opacity: 1 - depth * PEEK_FADE,
            },
          ]}
          contentStyle={styles.peekFill}
        />
      ))}
      <Glass variant="strong" radius={cardTier.hero.radius} contentStyle={styles.card}>
        <StatusPill label={headsUp} tone="headsUp" icon="inbox" />
        <View style={styles.headline}>
          <AppText variant="heading" accessibilityRole="header" numberOfLines={2}>
            {merchant}
          </AppText>
          <AppText
            variant="amountL"
            accessibilityLabel={spokenMoney(amountCents)}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {formatMoney(amountCents)}
          </AppText>
          <AppText variant="caption" color={colors.ink2}>
            {meta}
          </AppText>
        </View>
        {children}
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  peek: {
    position: 'absolute',
    top: PEEK_STEP * 2,
  },
  peekFill: { flex: 1 },
  card: {
    padding: cardTier.hero.padding,
    gap: space.lg,
  },
  headline: { gap: space.xxs },
});
