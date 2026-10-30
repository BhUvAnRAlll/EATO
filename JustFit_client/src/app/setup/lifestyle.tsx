import { Text, View } from "react-native";
import { router } from "expo-router";

import { Chip } from "@/components/setup/Chip";
import { OptionCard } from "@/components/setup/OptionCard";
import { SetupScreen } from "@/components/setup/SetupScreen";
import { mealsPerDayOptions, workoutFrequencyOptions, workoutTimeOptions, workoutTypeOptions } from "@/data/setup";
import { useSetupStore } from "@/store/setup";

export default function LifestyleWorkouts() {
  const { profile, update } = useSetupStore();
  const canContinue =
    profile.workoutFrequency !== null &&
    profile.workoutType !== null &&
    profile.workoutTime !== null &&
    profile.mealsPerDay !== null;

  return (
    <SetupScreen
      step="lifestyle"
      title="Lifestyle & workouts"
      subtitle="This helps us suggest the right meal timing and options for your routine."
      onNext={() => router.push("/setup/targets")}
      canContinue={canContinue}
    >
      <Text className="setup__section">Workout frequency</Text>
      <View className="mt-2.5 flex-row gap-2">
        {workoutFrequencyOptions.map((option) => (
          <Chip
            key={option.id}
            grow
            label={option.label}
            selected={profile.workoutFrequency === option.id}
            onPress={() => update({ workoutFrequency: option.id })}
          />
        ))}
      </View>

      <Text className="setup__section mt-6">Workout type</Text>
      <View className="mt-2.5 flex-row gap-2">
        {workoutTypeOptions.map((option) => (
          <OptionCard
            key={option.id}
            layout="tile"
            label={option.label}
            icon={option.icon}
            selected={profile.workoutType === option.id}
            onPress={() => update({ workoutType: option.id })}
          />
        ))}
      </View>

      <Text className="setup__section mt-6">Workout time</Text>
      <View className="mt-2.5 flex-row gap-2">
        {workoutTimeOptions.map((option) => (
          <OptionCard
            key={option.id}
            layout="tile"
            label={option.label}
            icon={option.icon}
            selected={profile.workoutTime === option.id}
            onPress={() => update({ workoutTime: option.id })}
          />
        ))}
      </View>

      <Text className="setup__section mt-6">Meals per day</Text>
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
