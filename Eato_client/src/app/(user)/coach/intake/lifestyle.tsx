import { Text, View } from "react-native";
import { router } from "expo-router";

import { Chip } from "@/components/setup/Chip";
import { ChoiceCard } from "@/components/coach/ChoiceCard";
import { IntakeFrame } from "@/components/coach/IntakeFrame";
import { cookingTimes, foodBudgets, sleepRanges, stressLevels } from "@/data/coach";
import { useCoachIntakeStore } from "@/store/coachIntake";

// Intake 7/9: kitchen time and food budget (for meals and recipes), then stress and sleep
// (optional, for recovery). Tapping a selected stress or sleep answer clears it.
export default function IntakeLifestyle() {
  const { draft, update } = useCoachIntakeStore();

  return (
    <IntakeFrame
      step="lifestyle"
      title="Your food and recovery"
      subtitle="So meals fit your kitchen and your wallet."
      onNext={() => router.push("/coach/intake/coach")}
      canContinue={draft.cookingTime !== null && draft.foodBudget !== null}
    >
      <View className="coach__card">
        <Text className="setup__section">Time to cook a meal</Text>
        <View className="flex-row flex-wrap gap-2">
          {cookingTimes.map((time) => (
            <View key={time.id} className="basis-2/5 flex-1">
              <Chip grow label={time.label} selected={draft.cookingTime === time.id} onPress={() => update({ cookingTime: time.id })} />
            </View>
          ))}
        </View>
      </View>

      <Text className="setup__section">Food budget</Text>
      <View className="gap-3" accessibilityRole="radiogroup">
        {foodBudgets.map((budget) => (
          <ChoiceCard key={budget.id} label={budget.label} note={budget.note} selected={draft.foodBudget === budget.id} onPress={() => update({ foodBudget: budget.id })} />
        ))}
      </View>

      <Text className="setup__section mt-2">Stress lately (optional)</Text>
      <View className="flex-row gap-3" accessibilityRole="radiogroup">
        {stressLevels.map((level) => (
          <ChoiceCard key={level.id} layout="tile" label={level.label} icon={level.icon} selected={draft.stress === level.id} onPress={() => update({ stress: draft.stress === level.id ? null : level.id })} />
        ))}
      </View>

      <View className="coach__card">
        <Text className="setup__section">Sleep a night (optional)</Text>
        <View className="flex-row flex-wrap gap-2">
          {sleepRanges.map((range) => (
            <View key={range.id} className="basis-2/5 flex-1">
              <Chip grow label={range.label} selected={draft.sleep === range.id} onPress={() => update({ sleep: draft.sleep === range.id ? null : range.id })} />
            </View>
          ))}
        </View>
      </View>
    </IntakeFrame>
  );
}
