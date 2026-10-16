import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReduceMotion } from '@/hooks/useAccessibilitySettings';
import { layout, radius, space, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Button } from './Button';
import { Glass } from './Glass';

type ConfirmSheetProps = {
  visible: boolean;
  title: string;
  /** Paragraphs shown under the title. */
  body: readonly string[];
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Bottom sheet that asks the user to confirm one choice. */
export function ConfirmSheet({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'fade' : 'slide'}
      onRequestClose={onCancel}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.root}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.hairline }]}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <Glass
          variant="strong"
          radius={radius.card}
          style={styles.sheet}
          contentStyle={[styles.content, { paddingBottom: insets.bottom + space.lg }]}
        >
          <AppText variant="heading" accessibilityRole="header">
            {title}
          </AppText>
          {body.map((paragraph) => (
            <AppText key={paragraph} variant="body" color={colors.ink2}>
              {paragraph}
            </AppText>
          ))}
          <Button label={confirmLabel} onPress={onConfirm} />
          <Button label={cancelLabel} variant="neutralTint" onPress={onCancel} />
        </Glass>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  content: {
    gap: space.md,
    paddingTop: space.xl,
    paddingHorizontal: layout.screenPadding,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
});
