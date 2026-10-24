import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { iconSize, layout, space, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';
import { Touchable } from './Touchable';

type ListRowProps = {
  title: string;
  subtitle?: string;
  /** Leading visual, usually a `CategoryTile` or `IconTile`. */
  leading?: ReactNode;
  /** Right side: an amount, a pill. Kept on one line and never squeezed. */
  trailing?: ReactNode;
  /** Shows a chevron: the row opens another screen. */
  chevron?: boolean;
  /** Extra content under the subtitle, e.g. a badge. */
  children?: ReactNode;
  titleLines?: number;
  onPress?: () => void;
  /** Defaults to "title, subtitle". */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
};

/**
 * One row inside a `ListCard`: leading tile, title + caption, trailing value or chevron. Same
 * height and spacing everywhere, pressable or not.
 */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  chevron = false,
  children,
  titleLines = 2,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ListRowProps) {
  const { colors } = useTheme();
  const label = accessibilityLabel ?? [title, subtitle].filter(Boolean).join(', ');

  const content = (
    <>
      {leading}
      <View style={styles.text}>
        <AppText variant="bodyStrong" numberOfLines={titleLines}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" color={colors.ink2}>
            {subtitle}
          </AppText>
        ) : null}
        {children}
      </View>
      {trailing !== undefined ? <View style={styles.trailing}>{trailing}</View> : null}
      {chevron ? <Icon name="chevronRight" size={iconSize.md} color={colors.ink2} /> : null}
    </>
  );

  if (onPress) {
    return (
      <Touchable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        testID={testID}
        style={styles.row}
      >
        {content}
      </Touchable>
    );
  }
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      testID={testID}
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.rowMinHeight,
    paddingVertical: layout.rowPaddingVertical,
  },
  text: { flex: 1, minWidth: 0, gap: space.xxs },
  trailing: { flexShrink: 0, alignItems: 'flex-end' },
});
