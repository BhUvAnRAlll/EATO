import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { OptionCard } from "@/components/setup/OptionCard";
import { SetupScreen } from "@/components/setup/SetupScreen";
import { goalOptions } from "@/data/setup";
import { editOrigin } from "@/lib/profileScan";
import { useSetupStore } from "@/store/setup";

// Profile › Goal & activity, step 1 of 3 (since 2026-11-10 not part of setup): opened with the
// saved answers in the setup store (startProfileEdit) and ?from= where it returns to
export default function ChooseGoal() {
  const { profile, update } = useSetupStore();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const origin = editOrigin(from);

  return (
    <SetupScreen
      title="What's your goal?"
      subtitle="Choose one that fits your current focus."
      onNext={() => router.push({ pathname: "/setup/activity", params: { from: origin } })}
      showProgress={false}
      canContinue={profile.goal !== null}
    >
      <View className="flex-row flex-wrap justify-between gap-y-3">
        {goalOptions.map((goal) => (
          <OptionCard
            key={goal.id}
            layout="grid"
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
