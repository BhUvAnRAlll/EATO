import { Text, View } from "react-native";
import { router } from "expo-router";

import { EmptyState } from "@/components/EmptyState";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ChoiceCard } from "@/components/coach/ChoiceCard";
import { IntakeFrame } from "@/components/coach/IntakeFrame";
import { equipmentBySpot, labelOf, spots } from "@/data/coach";
import { useCoachIntakeStore } from "@/store/coachIntake";

// Intake 5/9: what's at each spot, picked from a short list (gyms have gym-sized choices). The
// lists follow the spots picked on step 4; opened without one (a resumed or linked step), it says
// so and goes back there instead of showing nothing.
export default function IntakeEquipment() {
  const { draft, update } = useCoachIntakeStore();
  const backup = draft.backupSpot === "none" ? null : draft.backupSpot;

  return (
    <IntakeFrame
      step="equipment"
      title="What can you use?"
      subtitle="So every exercise fits what's actually there."
      onNext={() => router.push("/coach/intake/limits")}
      canContinue={draft.mainEquipment !== null && (backup === null || draft.backupEquipment !== null)}
    >
      {!draft.mainSpot && (
        <EmptyState icon={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" }} title="Pick where you train first" message="The equipment list follows your main spot.">
          <PrimaryButton label="Choose your spot" onPress={() => router.replace("/coach/intake/spots")} />
        </EmptyState>
      )}

      {draft.mainSpot && (
        <>
          <Text className="coach__section">{`${labelOf(spots, draft.mainSpot)} · main spot`}</Text>
          <View className="gap-3" accessibilityRole="radiogroup">
            {equipmentBySpot[draft.mainSpot].map((item) => (
              <ChoiceCard key={item.id} label={item.label} note={item.note} selected={draft.mainEquipment === item.id} onPress={() => update({ mainEquipment: item.id })} />
            ))}
          </View>
        </>
      )}

      {backup && (
        <>
          <Text className="coach__section mt-2">{`${labelOf(spots, backup)} · backup spot`}</Text>
          <View className="gap-3" accessibilityRole="radiogroup">
            {equipmentBySpot[backup].map((item) => (
              <ChoiceCard key={item.id} label={item.label} note={item.note} selected={draft.backupEquipment === item.id} onPress={() => update({ backupEquipment: item.id })} />
            ))}
          </View>
        </>
      )}
    </IntakeFrame>
  );
}
