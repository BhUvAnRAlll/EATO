import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChoiceCard } from "@/components/coach/ChoiceCard";
import { CoachButton } from "@/components/coach/CoachButton";
import { CoachChip } from "@/components/coach/CoachChip";
import { coaches, coachStyles, type CoachId, type CoachStyle } from "@/data/coach";

type Props = {
  coach: CoachId;
  coachStyle: CoachStyle;
  saving: boolean;
  error: string | null;
  onSave: (coach: CoachId, coachStyle: CoachStyle) => void;
  onClose: () => void;
};

// A bottom sheet on the Coach tab: pick another coach and how they talk to you. Mounted only
// while open, so it always starts on the saved choice; Save is off until something changes.
export function ChangeCoachSheet({ coach, coachStyle, saving, error, onSave, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [pickedCoach, setPickedCoach] = useState(coach);
  const [pickedStyle, setPickedStyle] = useState(coachStyle);

  const changed = pickedCoach !== coach || pickedStyle !== coachStyle;
  const name = coaches.find((c) => c.id === pickedCoach)?.name.replace("Coach ", "") ?? "";

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View className="verify__backdrop">
        <Pressable className="flex-1" onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View className="verify__sheet gap-4" style={{ maxHeight: "88%", paddingBottom: Math.max(insets.bottom, 16) + 8 }} accessibilityViewIsModal>
          <View className="flex-row items-center justify-between">
            <Text className="coach__section text-lg" accessibilityRole="header">Change coach</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Cancel">
              <Text className="coach__ghost-label">Cancel</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 4 }} showsVerticalScrollIndicator={false}>
            <View className="gap-3" accessibilityRole="radiogroup">
              {coaches.map((c) => (
                <ChoiceCard key={c.id} label={c.name} note={c.note} coach={c.id} selected={pickedCoach === c.id} onPress={() => setPickedCoach(c.id)} />
              ))}
            </View>
            <Text className="coach__section mt-1">{`How should ${name} coach you?`}</Text>
            <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
              {coachStyles.map((s) => (
                <CoachChip key={s.id} label={s.label} selected={pickedStyle === s.id} onPress={() => setPickedStyle(s.id)} />
              ))}
            </View>
            <Text className="coach__hint">Your current plan stays. Make a new plan any time for your new coach&apos;s meals.</Text>
          </ScrollView>

          {error && <Text className="macro__error" accessibilityRole="alert">{error}</Text>}
          <CoachButton label="Save" onPress={() => onSave(pickedCoach, pickedStyle)} loading={saving} disabled={!changed} />
        </View>
      </View>
    </Modal>
  );
}
