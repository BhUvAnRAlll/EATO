import { View } from "react-native";
import { router } from "expo-router";

import { OptionCard } from "@/components/setup/OptionCard";
import { SetupScreen } from "@/components/setup/SetupScreen";
import { goalOptions } from "@/data/setup";
import { useSetupStore } from "@/store/setup";

export default function ChooseGoal() {
  const { profile, update } = useSetupStore();

  return (
    <SetupScreen
      step="goal"
      title="What's your goal?"
      subtitle="Choose one that fits your current focus."
      onNext={() => router.push("/setup/body")}
      canContinue={profile.goal !== null}
    >
      <View className="gap-3">
        {goalOptions.map((goal) => (
          <OptionCard
            key={goal.id}
            label={goal.label}
            description={goal.description}
            icon={goal.icon}
            selected={profile.goal === goal.id}
            onPress={() => update({ goal: goal.id })}
          />
        ))}
      </View>
    </SetupScreen>
  );
}
