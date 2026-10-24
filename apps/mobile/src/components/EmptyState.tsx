import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { space, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Button, type ButtonVariant } from './Button';
import { Card } from './Card';
import type { IconName } from './Icon';
import { IconTile, type IconTone } from './IconTile';

export type EmptyStateAction = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

type EmptyStateProps = {
  title: string;
  body?: string;
  icon?: IconName;
  tone?: IconTone;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  /** `hero` when the empty state stands in for the screen's key number. */
  tier?: 'hero' | 'standard';
  /** Extra content under the body, e.g. a badge. */
  children?: ReactNode;
};

/**
 * "Nothing here yet" card: icon, title, one line of help and the next step. Used wherever a
 * list or number has nothing to show, so empty screens never look broken.
 */
export function EmptyState({
  title,
  body,
  icon,
  tone = 'accent',
  action,
  secondaryAction,
  tier = 'standard',
  children,
}: EmptyStateProps) {
  const { colors } = useTheme();
  return (
    <Card tier={tier} contentStyle={styles.card}>
      {icon ? <IconTile icon={icon} tone={tone} size="lg" round /> : null}
      <View style={styles.text}>
        <AppText variant="heading" accessibilityRole="header" style={styles.center}>
          {title}
        </AppText>
        {body ? (
          <AppText variant="body" color={colors.ink2} style={styles.center}>
            {body}
          </AppText>
        ) : null}
      </View>
      {children}
      {action || secondaryAction ? (
        <View style={styles.actions}>
          {action ? (
            <Button
              label={action.label}
              onPress={action.onPress}
              variant={action.variant ?? 'primary'}
              accessibilityLabel={action.accessibilityLabel}
              accessibilityHint={action.accessibilityHint}
            />
          ) : null}
          {secondaryAction ? (
            <Button
              label={secondaryAction.label}
              onPress={secondaryAction.onPress}
              variant={secondaryAction.variant ?? 'link'}
              accessibilityLabel={secondaryAction.accessibilityLabel}
              accessibilityHint={secondaryAction.accessibilityHint}
            />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', gap: space.md },
  text: { alignSelf: 'stretch', gap: space.xs },
  center: { textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: space.sm, marginTop: space.xs },
});
