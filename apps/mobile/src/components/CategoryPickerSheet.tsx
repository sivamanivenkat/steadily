import { CATEGORIES, type CategoryId } from '@steadily/taxonomy';
import { ScrollView, StyleSheet, View } from 'react-native';

import { space, useTheme } from '@/theme';

import { AppText } from './AppText';
import { BottomSheet } from './BottomSheet';
import { CategoryTile } from './CategoryTile';
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

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissLabel="Close category list"
      contentStyle={styles.content}
    >
      <View style={styles.header}>
        <AppText variant="heading" accessibilityRole="header" style={styles.title}>
          {title}
        </AppText>
        <IconButton icon="close" accessibilityLabel="Close" onPress={onClose} flat />
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
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  title: { flex: 1 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth * 2 },
});
