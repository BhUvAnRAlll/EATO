import { Text, View } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";

import { PressableScale } from "@/components/PressableScale";

// "Please confirm the details" (the user's design): the rows about to be saved, with Edit (back to
// the form) and Confirm. Drawn over a GymSheet through its `overlay`. Other confirmations (sending
// SMS) pass their own title and button words.
type ConfirmDialogProps = { rows: [string, string][]; onEdit: () => void; onConfirm: () => void; title?: string; editLabel?: string; confirmLabel?: string };
export function ConfirmDialog({ rows, onEdit, onConfirm, title = "Please confirm the details", editLabel = "Edit", confirmLabel = "Confirm" }: ConfirmDialogProps) {
  return (
    <Animated.View entering={FadeIn.duration(140).reduceMotion(ReduceMotion.System)} className="gym-confirm" accessibilityViewIsModal>
      <View className="gym-confirm__card">
        <Text className="gym-confirm__title" accessibilityRole="header">{title}</Text>
        <View style={{ gap: 14 }}>
          {rows.map(([label, value]) => (
            <View key={label} className="flex-row items-center justify-between" style={{ gap: 12 }} accessible accessibilityLabel={`${label}: ${value}`}>
              <Text className="gym-confirm__label">{label}</Text>
              <Text className="gym-confirm__value" numberOfLines={1}>{value}</Text>
            </View>
          ))}
        </View>
        <View className="flex-row justify-end" style={{ gap: 8 }}>
          <PressableScale onPress={onEdit} className="gym-confirm__action" accessibilityRole="button" accessibilityLabel={editLabel}>
            <Text className="gym-confirm__action-label">{editLabel}</Text>
          </PressableScale>
          <PressableScale onPress={onConfirm} haptic="tap" className="gym-confirm__action" accessibilityRole="button" accessibilityLabel={confirmLabel}>
            <Text className="gym-confirm__action-label">{confirmLabel}</Text>
          </PressableScale>
        </View>
      </View>
    </Animated.View>
  );
}
