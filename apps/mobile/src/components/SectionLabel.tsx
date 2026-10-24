import { StyleSheet, View } from 'react-native';

import { iconSize, layout, space, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';
import { Touchable } from './Touchable';

export type SectionAction = {
  label: string;
  onPress: () => void;
  /** Spoken name, e.g. "See all budgets" for a visible "See all". */
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

/** Lifts the compact action's hit area to the 44 pt minimum without growing the row. */
const ACTION_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 8 };

/**
 * Uppercase section label ("RECENT"), read as a header, with an optional trailing action
 * ("See all"). Label and action are centered on one line of the same height, so they always sit
 * level, and the label hugs the content below it.
 */
export function SectionLabel({ children, action }: { children: string; action?: SectionAction }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <AppText variant="label" color={colors.ink2} accessibilityRole="header" style={styles.label}>
        {children}
      </AppText>
      {action ? (
        <Touchable
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={action.accessibilityLabel ?? action.label}
          accessibilityHint={action.accessibilityHint}
          hitSlop={ACTION_HIT_SLOP}
          style={styles.action}
        >
          <AppText variant="captionStrong" color={colors.accentInk}>
            {action.label}
          </AppText>
          <Icon name="chevronRight" size={iconSize.badge + 2} color={colors.accentInk} />
        </Touchable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 24,
    marginTop: layout.sectionGap,
    marginBottom: layout.sectionLabelPull,
    paddingHorizontal: space.xs,
  },
  label: { flex: 1, minWidth: 0 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xxs,
    minHeight: 24,
  },
});
