import { useState } from "react";
import { Text, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";
import { router } from "expo-router";

import { Chip } from "@/components/setup/Chip";
import { SelectSheet } from "@/components/setup/SelectSheet";
import { SetupField } from "@/components/setup/SetupField";
import { SetupScreen } from "@/components/setup/SetupScreen";
import { activityOptions, healthFlagOptions } from "@/data/setup";
import { useSetupStore } from "@/store/setup";
import { useThemeColors } from "@/theme";

export default function Activity() {
  const colors = useThemeColors();
  const { profile, update, toggleHealthFlag } = useSetupStore();
  const [isActivityOpen, setIsActivityOpen] = useState(false);

  const activity = activityOptions.find((a) => a.id === profile.activity);

  return (
    <SetupScreen
      step="activity"
      title="How active are you?"
      subtitle="This helps us calculate your nutrition needs accurately."
      onNext={() => router.push("/setup/food")}
      canContinue={profile.activity !== null}
    >
      <View className="gap-3">
        <SetupField
          label="Activity level"
          icon={{ ios: "figure.run", android: "directions_run", web: "directions_run" }}
          placeholder="Select"
          value={activity?.label ?? ""}
          onPress={() => setIsActivityOpen(true)}
        />

        {activity && (
          <View className="setup__info">
            <SymbolView
              name={{ ios: "info.circle", android: "info", web: "info" }}
              size={16}
              tintColor={colors.leaf}
            />
            <Text className="setup__card-text flex-1">
              {`You're ${activity.label.toLowerCase()} if you ${activity.description}.`}
            </Text>
          </View>
        )}
      </View>

      {/* Optional safety check: any of these sends the targets to professional guidance */}
      <Text className="setup__section mt-6">
        Do any of these apply? <Text className="setup__optional">(optional)</Text>
      </Text>
      <Text className="setup__card-text mt-1">
        {"If so, we'll ask you to use a target from your doctor or dietitian instead of calculating one."}
      </Text>
      <View className="mt-2.5 flex-row flex-wrap gap-2">
        {healthFlagOptions.map((flag) => (
          <Chip
            key={flag.id}
            label={flag.label}
            selected={profile.healthFlags.includes(flag.id)}
            onPress={() => toggleHealthFlag(flag.id)}
          />
        ))}
      </View>

      <SelectSheet
        visible={isActivityOpen}
        title="Activity level"
        options={activityOptions}
        selected={profile.activity}
        onSelect={(id) => update({ activity: id })}
        onClose={() => setIsActivityOpen(false)}
      />
    </SetupScreen>
  );
}
