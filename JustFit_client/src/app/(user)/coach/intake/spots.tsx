import { Text, View } from "react-native";
import { router } from "expo-router";

import { ChoiceCard } from "@/components/coach/ChoiceCard";
import { IntakeFrame } from "@/components/coach/IntakeFrame";
import { equipmentBySpot, spots, type Spot } from "@/data/coach";
import { useCoachIntakeStore } from "@/store/coachIntake";

// Intake 4/9: the main spot, and a backup for busy days (or none)
export default function IntakeSpots() {
  const { draft, update } = useCoachIntakeStore();

  // A new spot clears equipment that doesn't exist there, and a backup can't equal the main spot
  const pickMain = (spot: Spot) => {
    const keepEquipment = equipmentBySpot[spot].some((e) => e.id === draft.mainEquipment);
    update({ mainSpot: spot, mainEquipment: keepEquipment ? draft.mainEquipment : null, ...(draft.backupSpot === spot ? { backupSpot: null, backupEquipment: null } : {}) });
  };
  const pickBackup = (spot: Spot | "none") => {
    const keepEquipment = spot !== "none" && equipmentBySpot[spot].some((e) => e.id === draft.backupEquipment);
    update({ backupSpot: spot, backupEquipment: keepEquipment ? draft.backupEquipment : null });
  };

  return (
    <IntakeFrame
      step="spots"
      title="Where do you train most?"
      subtitle="Your main spot first, then a backup for busy days."
      onNext={() => router.push("/coach/intake/equipment")}
      canContinue={draft.mainSpot !== null && draft.backupSpot !== null}
    >
      <Text className="coach__section">Main spot</Text>
      <View className="flex-row flex-wrap gap-3" accessibilityRole="radiogroup">
        {spots.map((spot) => (
          <ChoiceCard key={spot.id} layout="tile" label={spot.label} icon={spot.icon} selected={draft.mainSpot === spot.id} onPress={() => pickMain(spot.id)} />
        ))}
      </View>

      {draft.mainSpot && (
        <>
          <Text className="coach__section mt-2">Backup spot</Text>
          <View className="flex-row flex-wrap gap-3" accessibilityRole="radiogroup">
            {spots
              .filter((spot) => spot.id !== draft.mainSpot)
              .map((spot) => (
                <ChoiceCard key={spot.id} layout="tile" label={spot.label} icon={spot.icon} selected={draft.backupSpot === spot.id} onPress={() => pickBackup(spot.id)} />
              ))}
            <ChoiceCard layout="tile" label="No backup" icon={{ ios: "minus", android: "remove", web: "remove" }} selected={draft.backupSpot === "none"} onPress={() => pickBackup("none")} />
          </View>
        </>
      )}
    </IntakeFrame>
  );
}
