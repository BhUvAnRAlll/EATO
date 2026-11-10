import { View } from "react-native";
import { router } from "expo-router";

import { ChoiceCard } from "@/components/coach/ChoiceCard";
import { IntakeFrame } from "@/components/coach/IntakeFrame";
import { activityOptions } from "@/data/setup";
import { useCoachIntakeStore } from "@/store/coachIntake";

// Intake 3/10 (2026-11-10, moved here from setup): how active the member's day is, workouts
// included. With the goal, it sets the daily calorie target (worked out in code when the intake is saved).
export default function IntakeActivity() {
  const { draft, update } = useCoachIntakeStore();

  return (
    <IntakeFrame
      step="activity"
      title="How active is your day?"
      subtitle="Count your job, walking and workouts together."
      onNext={() => router.push("/coach/intake/schedule")}
      canContinue={draft.activity !== null}
    >
      <View className="gap-3" accessibilityRole="radiogroup">
        {activityOptions.map((option) => (
          <ChoiceCard key={option.id} label={option.label} note={option.description ? option.description.charAt(0).toUpperCase() + option.description.slice(1) : undefined} selected={draft.activity === option.id} onPress={() => update({ activity: option.id })} />
        ))}
      </View>
    </IntakeFrame>
  );
}
