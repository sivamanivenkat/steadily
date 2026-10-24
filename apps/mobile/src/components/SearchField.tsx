import { StyleSheet, TextInput } from 'react-native';

import { iconSize, layout, radius, space, type, useTheme } from '@/theme';

import { Glass } from './Glass';
import { Icon } from './Icon';
import { Touchable } from './Touchable';

type SearchFieldProps = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  accessibilityLabel: string;
};

/** Search box on light glass with a clear button. */
export function SearchField({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
}: SearchFieldProps) {
  const { colors } = useTheme();
  return (
    <Glass variant="light" radius={radius.button} elevation="none" fixed contentStyle={styles.box}>
      <Icon name="search" size={iconSize.md} color={colors.ink2} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.ink2}
        accessibilityLabel={accessibilityLabel}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        clearButtonMode="never"
        style={[type.body, styles.input, { color: colors.ink }]}
      />
      {value ? (
        <Touchable
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={8}
          style={styles.clear}
        >
          <Icon name="close" size={iconSize.sm} color={colors.ink2} />
        </Touchable>
      ) : null}
    </Glass>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.md,
    paddingRight: space.xs,
    minHeight: layout.touchTarget + space.xs,
  },
  input: { flex: 1, paddingVertical: space.sm },
  clear: {
    width: layout.touchTarget,
    height: layout.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
