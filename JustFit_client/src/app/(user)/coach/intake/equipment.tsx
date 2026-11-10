import { Text, View } from "react-native";
import { router } from "expo-router";

import { EmptyState } from "@/components/EmptyState";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ChoiceCard } from "@/components/coach/ChoiceCard";
import { IntakeFrame } from "@/components/coach/IntakeFrame";
import { equipmentBySpot, labelOf, spots } from "@/data/coach";
import { useCoachIntakeStore } from "@/store/coachIntake";

// Intake 6/10: what's at the main spot, picked from a short list (gyms have gym-sized choices).
// The list follows the spot picked on step 5; opened without one (a resumed or linked step), it
// says so and goes back there instead of showing nothing.
export default function IntakeEquipment() {
  const { draft, update } = useCoachIntakeStore();

  return (
    <IntakeFrame
      step="equipment"
      title="What can you use?"
      subtitle="So every exercise fits what's actually there."
      onNext={() => router.push("/coach/intake/limits")}
      canContinue={draft.mainEquipment !== null}
    >
      {!draft.mainSpot && (
        <EmptyState icon={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" }} title="Pick where you train first" message="The equipment list follows your main spot.">
          <PrimaryButton label="Choose your spot" onPress={() => router.replace("/coach/intake/spots")} />
        </EmptyState>
      )}

      {draft.mainSpot && (
        <>
          <Text className="coach__section">{labelOf(spots, draft.mainSpot)}</Text>
          <View className="gap-3" accessibilityRole="radiogroup">
            {equipmentBySpot[draft.mainSpot].map((item) => (
              <ChoiceCard key={item.id} label={item.label} note={item.note} selected={draft.mainEquipment === item.id} onPress={() => update({ mainEquipment: item.id })} />
            ))}
          </View>
        </>
      )}

    </IntakeFrame>
  );
}
