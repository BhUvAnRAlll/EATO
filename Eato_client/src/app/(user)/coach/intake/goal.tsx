import { View } from "react-native";
import { router } from "expo-router";

import { ChoiceCard } from "@/components/coach/ChoiceCard";
import { IntakeFrame } from "@/components/coach/IntakeFrame";
import { coachGoals } from "@/data/coach";
import { useCoachIntakeStore } from "@/store/coachIntake";

// Intake 1/9: the one goal the coach builds around
export default function IntakeGoal() {
  const { draft, update } = useCoachIntakeStore();

  return (
    <IntakeFrame step="goal" title="What's your goal?" subtitle="Pick the one that matters most right now." onNext={() => router.push("/coach/intake/experience")} canContinue={draft.goal !== null}>
      <View className="flex-row flex-wrap gap-3" accessibilityRole="radiogroup">
        {coachGoals.map((goal) => (
          <ChoiceCard key={goal.id} layout="tile" label={goal.label} icon={goal.icon} selected={draft.goal === goal.id} onPress={() => update({ goal: goal.id })} />
        ))}
      </View>
    </IntakeFrame>
  );
}
