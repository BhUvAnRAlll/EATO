import { useEffect } from "react";
import { Keyboard, ScrollView, Text, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";

import { PressableScale } from "@/components/PressableScale";

// "Please confirm the details" (the user's design): the rows about to be saved, with Edit (back to
// the form) and Confirm. Drawn over a GymSheet through its `overlay`. Other confirmations (sending
// SMS) pass their own title and button words. The keyboard goes down as the dialog opens (fixed
// 2026-11-07, the user's screenshot: Pause Membership's dialog opened over the keyboard, which hid
// Edit and Confirm when the reason field still had focus).
// `busy`: the confirmed action is running, so neither button takes another tap (a paid SMS was
// sendable twice with two quick taps, QA 2026-11-07)
type ConfirmDialogProps = { rows: [string, string][]; onEdit: () => void; onConfirm: () => void; title?: string; editLabel?: string; confirmLabel?: string; busy?: boolean };
export function ConfirmDialog({ rows, onEdit, onConfirm, title = "Please confirm the details", editLabel = "Edit", confirmLabel = "Confirm", busy = false }: ConfirmDialogProps) {
  // The rows scroll inside the card when they don't fit (seven rows at a large text size on a small
  // phone pushed Edit and Confirm off the screen, 2026-11-08 audit); the buttons always show
  const rowsMax = useWindowDimensions().height * 0.55;
  useEffect(() => {
    Keyboard.dismiss();
  }, []);
  return (
    <Animated.View entering={FadeIn.duration(140).reduceMotion(ReduceMotion.System)} className="gym-confirm" accessibilityViewIsModal>
      <View className="gym-confirm__card">
        <Text className="gym-confirm__title" accessibilityRole="header">{title}</Text>
        <ScrollView style={{ maxHeight: rowsMax, flexGrow: 0 }} contentContainerStyle={{ gap: 14 }} showsVerticalScrollIndicator={false} bounces={false}>
          {rows.map(([label, value]) => (
            <View key={label} className="flex-row items-center justify-between" style={{ gap: 12 }} accessible accessibilityLabel={`${label}: ${value}`}>
              <Text className="gym-confirm__label">{label}</Text>
              <Text className="gym-confirm__value" style={{ flexShrink: 1, textAlign: "right" }} numberOfLines={3}>{value}</Text>
            </View>
          ))}
        </ScrollView>
        <View className="flex-row justify-end" style={{ gap: 8 }}>
          <PressableScale onPress={onEdit} disabled={busy} className="gym-confirm__action" accessibilityRole="button" accessibilityLabel={editLabel}>
            <Text className="gym-confirm__action-label">{editLabel}</Text>
          </PressableScale>
          <PressableScale onPress={onConfirm} disabled={busy} haptic="tap" className="gym-confirm__action" style={busy ? { opacity: 0.5 } : undefined} accessibilityRole="button" accessibilityLabel={confirmLabel} accessibilityState={{ disabled: busy, busy }}>
            <Text className="gym-confirm__action-label">{busy ? `${confirmLabel}…` : confirmLabel}</Text>
          </PressableScale>
        </View>
      </View>
    </Animated.View>
  );
}
