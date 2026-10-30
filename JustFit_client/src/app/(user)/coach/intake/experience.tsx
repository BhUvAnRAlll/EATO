import { Text, View } from "react-native";
import { router } from "expo-router";

import { ChoiceCard } from "@/components/coach/ChoiceCard";
import { IntakeFrame } from "@/components/coach/IntakeFrame";
import { experienceLevels } from "@/data/coach";
import { useCoachIntakeStore } from "@/store/coachIntake";

const bars = { ios: "cellularbars", android: "signal_cellular_alt", web: "signal_cellular_alt" } as const;

// Intake 2/9: experience and whether they train now (sets the starting point)
export default function IntakeExperience() {
  const { draft, update } = useCoachIntakeStore();

  return (
    <IntakeFrame
      step="experience"
      title="How experienced are you?"
      onNext={() => router.push("/coach/intake/schedule")}
      canContinue={draft.experience !== null && draft.currentlyTraining !== null}
    >
      <View className="gap-3" accessibilityRole="radiogroup">
        {experienceLevels.map((level) => (
          <ChoiceCard key={level.id} label={level.label} note={level.note} icon={bars} selected={draft.experience === level.id} onPress={() => update({ experience: level.id })} />
        ))}
      </View>

      <Text className="coach__section mt-2">Are you working out now?</Text>
      <View className="flex-row gap-3" accessibilityRole="radiogroup">
        <ChoiceCard layout="tile" label="Yes" icon={{ ios: "dumbbell", android: "fitness_center", web: "fitness_center" }} selected={draft.currentlyTraining === true} onPress={() => update({ currentlyTraining: true })} />
        <ChoiceCard layout="tile" label="No" icon={{ ios: "moon.zzz", android: "bedtime", web: "bedtime" }} selected={draft.currentlyTraining === false} onPress={() => update({ currentlyTraining: false })} />
      </View>
    </IntakeFrame>
  );
}
