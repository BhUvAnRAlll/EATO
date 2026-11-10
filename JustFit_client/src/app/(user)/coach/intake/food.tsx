import { Text, View } from "react-native";
import { router } from "expo-router";

import { CoachChip } from "@/components/coach/CoachChip";
import { ChoiceCard } from "@/components/coach/ChoiceCard";
import { IntakeFrame } from "@/components/coach/IntakeFrame";
import { FoodForm, foodComplete } from "@/components/food/FoodForm";
import { cookingTimes, foodBudgets } from "@/data/coach";
import { useCoachIntakeStore } from "@/store/coachIntake";

// Intake 9/10 (2026-11-10, moved here from setup): the food answers the meals are planned from
// (diet, food usually eaten, allergies, dislikes, meals per day; the same form as Profile ›
// Food preferences), then cooking time and food budget. Allergies and diet are also checked in
// code on every meal the coach writes.
export default function IntakeFood() {
  const { draft, update, updateFood } = useCoachIntakeStore();

  return (
    <IntakeFrame
      step="food"
      title="Your food"
      subtitle="So every meal fits your diet, your kitchen and your wallet."
      onNext={() => router.push("/coach/intake/coach")}
      canContinue={foodComplete(draft.food) && draft.cookingTime !== null && draft.foodBudget !== null}
    >
      <FoodForm value={draft.food} onChange={updateFood} />

      <View className="gap-3">
        <Text className="coach__section">Time to cook a meal</Text>
        <View className="flex-row flex-wrap gap-2.5">
          {cookingTimes.map((time) => (
            <CoachChip key={time.id} grow label={time.label} selected={draft.cookingTime === time.id} onPress={() => update({ cookingTime: time.id })} />
          ))}
        </View>
      </View>

      <Text className="coach__section">Food budget</Text>
      <View className="gap-3" accessibilityRole="radiogroup">
        {foodBudgets.map((budget) => (
          <ChoiceCard key={budget.id} label={budget.label} note={budget.note} selected={draft.foodBudget === budget.id} onPress={() => update({ foodBudget: budget.id })} />
        ))}
      </View>
    </IntakeFrame>
  );
}
