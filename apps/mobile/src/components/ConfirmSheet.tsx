import { useTheme } from '@/theme';

import { AppText } from './AppText';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';

type ConfirmSheetProps = {
  visible: boolean;
  title: string;
  /** Paragraphs shown under the title. */
  body: readonly string[];
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** The confirm action deletes something that cannot be undone: uses the destructive button. */
  destructive?: boolean;
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
  destructive = false,
}: ConfirmSheetProps) {
  const { colors } = useTheme();

  return (
    <BottomSheet visible={visible} onClose={onCancel}>
      <AppText variant="heading" accessibilityRole="header">
        {title}
      </AppText>
      {body.map((paragraph) => (
        <AppText key={paragraph} variant="body" color={colors.ink2}>
          {paragraph}
        </AppText>
      ))}
      <Button
        label={confirmLabel}
        variant={destructive ? 'destructive' : 'primary'}
        onPress={onConfirm}
      />
      <Button label={cancelLabel} variant="neutralTint" onPress={onCancel} />
    </BottomSheet>
  );
}
