import { StyleSheet } from 'react-native';

import { space, useTheme } from '@/theme';

import { AppText } from './AppText';

/** Uppercase section label ("RECENT"), read as a header. */
export function SectionLabel({ children }: { children: string }) {
  const { colors } = useTheme();
  return (
    <AppText variant="label" color={colors.ink2} accessibilityRole="header" style={styles.label}>
      {children}
    </AppText>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: space.sm },
});
