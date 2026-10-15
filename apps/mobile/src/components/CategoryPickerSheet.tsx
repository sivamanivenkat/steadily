import { CATEGORIES, type CategoryId } from '@steadily/taxonomy';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReduceMotion } from '@/hooks/useAccessibilitySettings';
import { layout, radius, space, useTheme } from '@/theme';

import { AppText } from './AppText';
import { CategoryTile } from './CategoryTile';
import { Glass } from './Glass';
import { IconButton } from './IconButton';
import { RadioRow } from './RadioRow';

type CategoryPickerSheetProps = {
  visible: boolean;
  title?: string;
  selectedId?: CategoryId | null;
  onSelect: (id: CategoryId) => void;
  onClose: () => void;
};

/** Bottom sheet listing all 15 categories from the taxonomy (the "More" chip). */
export function CategoryPickerSheet({
  visible,
  title = 'Pick a category',
  selectedId = null,
  onSelect,
  onClose,
}: CategoryPickerSheetProps) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'fade' : 'slide'}
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.root}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.hairline }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close category list"
        />
        <Glass
          variant="strong"
          radius={radius.card}
          style={styles.sheet}
          contentStyle={[styles.content, { paddingBottom: insets.bottom + space.lg }]}
        >
          <View style={styles.header}>
            <AppText variant="heading" accessibilityRole="header" style={styles.title}>
              {title}
            </AppText>
            <IconButton icon="close" accessibilityLabel="Close" onPress={onClose} />
          </View>
          <ScrollView accessibilityRole="radiogroup" accessibilityLabel={title}>
            {CATEGORIES.map((category, i) => (
              <View
                key={category.id}
                style={i > 0 && [styles.divider, { borderTopColor: colors.hairline }]}
              >
                <RadioRow
                  label={category.name}
                  selected={selectedId === category.id}
                  onPress={() => onSelect(category.id)}
                  leading={<CategoryTile categoryId={category.id} icon={category.icon} />}
                />
              </View>
            ))}
          </ScrollView>
        </Glass>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '85%', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  content: {
    paddingTop: space.lg,
    paddingHorizontal: layout.screenPadding,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.sm,
  },
  title: { flex: 1 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth * 2 },
});
