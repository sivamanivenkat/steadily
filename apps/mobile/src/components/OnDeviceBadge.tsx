import { StyleSheet, View } from 'react-native';

import { iconSize, radius, space, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';

/** "On-device" pill. Shown wherever processing happened locally. */
export function OnDeviceBadge() {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.pill, { backgroundColor: colors.onDevice.bg }]}
      accessible
      accessibilityLabel="Processed on this device"
    >
      <Icon name="check" size={iconSize.badge} color={colors.onDevice.text} strokeWidth={2.4} />
      <AppText variant="captionStrong" color={colors.onDevice.text}>
        On-device
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    paddingHorizontal: space.sm + 2,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
});
