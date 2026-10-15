import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { layout, radius, space, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Glass } from './Glass';
import { Screen } from './Screen';

type PlaceholderScreenProps = {
  title: string;
  heading: string;
  body: string;
  /** Extra content above the title, e.g. a back button. */
  header?: ReactNode;
  footer?: ReactNode;
  withTabBar?: boolean;
};

/** Temporary screen shell for tabs that are not built yet. */
export function PlaceholderScreen({
  title,
  heading,
  body,
  header,
  footer,
  withTabBar,
}: PlaceholderScreenProps) {
  const { colors } = useTheme();
  return (
    <Screen withTabBar={withTabBar}>
      {header}
      <AppText variant="title" accessibilityRole="header" style={styles.title}>
        {title}
      </AppText>
      <Glass variant="strong" radius={radius.cardSmall} contentStyle={styles.card}>
        <AppText variant="heading">{heading}</AppText>
        <AppText variant="body" color={colors.ink2}>
          {body}
        </AppText>
        {footer}
      </Glass>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { marginBottom: space.xs },
  card: { padding: layout.cardPadding, gap: space.sm },
});
