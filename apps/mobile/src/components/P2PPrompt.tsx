import { Pressable, StyleSheet, View } from 'react-native';

import type { P2PPurpose } from '@/data/types';
import { layout, radius, space } from '@/theme';

import { AppText } from './AppText';
import { Glass } from './Glass';

export const P2P_OPTIONS: readonly { purpose: P2PPurpose; label: string }[] = [
  { purpose: 'split_bill', label: 'Split a bill' },
  { purpose: 'paying_back', label: 'Paying back' },
  { purpose: 'rent', label: 'Rent' },
  { purpose: 'gift', label: 'Gift' },
];

/**
 * For payments to a person (Venmo, Zelle, Cash App): "What was this for?" (D-009). Shown inside
 * the review card in place of the category chips.
 */
export function P2PPrompt({ onChoose }: { onChoose: (purpose: P2PPurpose) => void }) {
  return (
    <View style={styles.root}>
      <AppText variant="heading">What was this for?</AppText>
      <View style={styles.options}>
        {P2P_OPTIONS.map((option) => (
          <Pressable
            key={option.purpose}
            onPress={() => onChoose(option.purpose)}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}
          >
            <Glass
              variant="light"
              radius={radius.pill}
              shadow={false}
              fixed
              contentStyle={styles.pill}
            >
              <AppText variant="bodyStrong">{option.label}</AppText>
            </Glass>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.md },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  option: { flexGrow: 1, flexBasis: '45%' },
  pill: {
    minHeight: layout.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  pressed: { opacity: 0.7 },
});
