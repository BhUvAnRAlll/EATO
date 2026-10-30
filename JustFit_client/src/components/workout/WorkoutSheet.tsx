import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { colors } from "@/theme";

type WorkoutSheetProps = {
  visible: boolean;
  emoji: string;
  title: string;
  text: string;
  confirmLabel: string;
  cancelLabel: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

// A workout prompt from the bottom ("Do it today instead?", "Swap with today?", "End this
// session?"), drawn over the screen like ConfirmSheet but not destructive-red. While the
// request is in flight it can't be dismissed, so a tap outside never hides a running change.
export function WorkoutSheet({ visible, emoji, title, text, confirmLabel, cancelLabel, busy, error, onConfirm, onCancel }: WorkoutSheetProps) {
  if (!visible) return null;
  return (
    <View className="confirm__backdrop" accessibilityViewIsModal>
      <Pressable style={{ flex: 1 }} onPress={busy ? undefined : onCancel} accessibilityLabel="Close" />
      <View className="confirm__sheet">
        <Text className="workout-sheet__emoji">{emoji}</Text>
        <Text className="setup__section text-center">{title}</Text>
        <Text className="home__note mt-1 text-center">{text}</Text>
        {error && <View className="mt-3"><FormAlert message={error} /></View>}
        <Pressable onPress={onConfirm} disabled={busy} className="btn-forest mt-4" style={{ opacity: busy ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel={confirmLabel}>
          {busy ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">{confirmLabel}</Text>}
        </Pressable>
        <Pressable onPress={onCancel} disabled={busy} className="btn-outline mt-2" style={{ opacity: busy ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel={cancelLabel}>
          <Text className="btn-outline__label">{cancelLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}
