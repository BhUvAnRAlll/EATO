import { View } from "react-native";
import { router } from "expo-router";

import { ChoiceCard } from "@/components/coach/ChoiceCard";
import { IntakeFrame } from "@/components/coach/IntakeFrame";
import { equipmentBySpot, spots, type Spot } from "@/data/coach";
import { useCoachIntakeStore } from "@/store/coachIntake";

// Intake 5/10: where the member trains most (the backup spot was removed on 2026-11-10)
export default function IntakeSpots() {
  const { draft, update } = useCoachIntakeStore();

  // A new spot clears equipment that doesn't exist there
  const pickMain = (spot: Spot) => {
    const keepEquipment = equipmentBySpot[spot].some((e) => e.id === draft.mainEquipment);
    update({ mainSpot: spot, mainEquipment: keepEquipment ? draft.mainEquipment : null });
  };

  return (
    <IntakeFrame
      step="spots"
      title="Where do you train most?"
      subtitle="Pick the place you work out most often."
      onNext={() => router.push("/coach/intake/equipment")}
      canContinue={draft.mainSpot !== null}
    >
      <View className="flex-row flex-wrap gap-3" accessibilityRole="radiogroup">
        {spots.map((spot) => (
          <ChoiceCard key={spot.id} layout="tile" label={spot.label} icon={spot.icon} selected={draft.mainSpot === spot.id} onPress={() => pickMain(spot.id)} />
        ))}
      </View>

    </IntakeFrame>
  );
}
