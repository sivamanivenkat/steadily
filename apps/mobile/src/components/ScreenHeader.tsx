import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { layout, space, useTheme } from '@/theme';

import { AppText } from './AppText';
import type { IconName } from './Icon';
import { IconButton } from './IconButton';

type ScreenHeaderProps = {
  title: string;
  /** Small line above the title, e.g. today's date or the month. */
  eyebrow?: string;
  /** Caption under the title. */
  subtitle?: string;
  onBack?: () => void;
  backIcon?: IconName;
  backLabel?: string;
  /**
   * Trailing controls (icon buttons, a link, a badge). With an `eyebrow` they share the top line
   * with it and the title gets the full width below, so a row of buttons never squeezes the title
   * onto two lines. Without one they sit at the end of the title row.
   */
  right?: ReactNode;
};

/**
 * Screen title block. Two layouts:
 * - Tab roots (`eyebrow`): eyebrow + actions on one line, large title below at full width.
 * - Stack screens: back/close button, title (and subtitle), trailing control, on one row.
 */
export function ScreenHeader({
  title,
  eyebrow,
  subtitle,
  onBack,
  backIcon = 'chevronLeft',
  backLabel = 'Back',
  right,
}: ScreenHeaderProps) {
  const { colors } = useTheme();

  const titleText = (
    <AppText variant="title" accessibilityRole="header">
      {title}
    </AppText>
  );
  const subtitleText = subtitle ? (
    <AppText variant="caption" color={colors.ink2}>
      {subtitle}
    </AppText>
  ) : null;

  if (eyebrow !== undefined) {
    return (
      <View style={styles.stack}>
        <View style={[styles.topLine, right ? styles.topLineWithActions : null]}>
          <AppText variant="captionStrong" color={colors.ink2} style={styles.eyebrow}>
            {eyebrow}
          </AppText>
          {right ? <View style={styles.actions}>{right}</View> : null}
        </View>
        {titleText}
        {subtitleText}
      </View>
    );
  }

  return (
    <View style={styles.row}>
      {onBack ? (
        <IconButton icon={backIcon} accessibilityLabel={backLabel} onPress={onBack} />
      ) : null}
      <View style={styles.text}>
        {titleText}
        {subtitleText}
      </View>
      {right ? <View style={styles.actions}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.xxs, marginBottom: space.xs },
  topLine: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  topLineWithActions: { minHeight: layout.touchTarget },
  eyebrow: { flex: 1, minWidth: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.touchTarget,
    marginBottom: space.xs,
  },
  text: { flex: 1, minWidth: 0, gap: space.xxs },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 0 },
});
