import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { space, useTheme } from '@/theme';

import { AppText } from './AppText';
import type { IconName } from './Icon';
import { IconButton } from './IconButton';

type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backIcon?: IconName;
  backLabel?: string;
  /** Trailing control, e.g. an icon button. */
  right?: ReactNode;
};

/** Title row for stack screens: optional back/close button, title, optional trailing control. */
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  backIcon = 'chevronLeft',
  backLabel = 'Back',
  right,
}: ScreenHeaderProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      {onBack ? (
        <IconButton icon={backIcon} accessibilityLabel={backLabel} onPress={onBack} />
      ) : null}
      <View style={styles.text}>
        <AppText variant="title" accessibilityRole="header">
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" color={colors.ink2}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.xs },
  text: { flex: 1, gap: 2 },
});
