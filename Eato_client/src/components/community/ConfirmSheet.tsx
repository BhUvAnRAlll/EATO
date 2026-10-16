import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { colors } from "@/theme";

type ConfirmSheetProps = {
  visible: boolean;
  title: string;
  text: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

// A destructive confirmation ("Delete this story?") drawn over the screen, not in a Modal, so
// it can open the moment an options sheet closes. The server still decides who may do it.
export function ConfirmSheet({ visible, title, text, confirmLabel, busy = false, onConfirm, onCancel }: ConfirmSheetProps) {
  if (!visible) return null;
  return (
    <View className="confirm__backdrop" accessibilityViewIsModal>
      <Pressable style={{ flex: 1 }} onPress={busy ? undefined : onCancel} accessibilityLabel="Close" />
      <View className="confirm__sheet">
        <Text className="setup__section text-center">{title}</Text>
        <Text className="home__note mt-1 text-center">{text}</Text>
        <Pressable onPress={onConfirm} disabled={busy} className="btn-forest mt-4" style={{ backgroundColor: colors.danger, opacity: busy ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel={confirmLabel}>
          {busy ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">{confirmLabel}</Text>}
        </Pressable>
        <Pressable onPress={onCancel} disabled={busy} className="btn-outline mt-2" accessibilityRole="button" accessibilityLabel="Cancel">
          <Text className="btn-outline__label">Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}
