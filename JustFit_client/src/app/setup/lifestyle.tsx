import { Text, View } from "react-native";
import { router } from "expo-router";

import { Chip } from "@/components/setup/Chip";
import { SetupScreen } from "@/components/setup/SetupScreen";
import { mealsPerDayOptions } from "@/data/setup";
import { useSetupStore } from "@/store/setup";

// Setup's lifestyle step: only meals per day. Workout frequency, type and time were removed on
// 2026-11-09 because the AI Coach intake asks them in more detail (days, spot, equipment)
export default function LifestyleMeals() {
  const { profile, update } = useSetupStore();

  return (
    <SetupScreen
      step="lifestyle"
      title="Your meals"
      subtitle="This helps us suggest the right meal timing and portions for your day."
      onNext={() => router.push("/setup/targets")}
      canContinue={profile.mealsPerDay !== null}
    >
      <Text className="setup__section">Meals per day</Text>
      <View className="mt-2.5 flex-row gap-2">
        {mealsPerDayOptions.map((option) => (
          <Chip
            key={option.id}
            grow
            label={option.label}
            selected={profile.mealsPerDay === option.id}
            onPress={() => update({ mealsPerDay: option.id })}
          />
        ))}
      </View>
    </SetupScreen>
  );
}
