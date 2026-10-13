import { useState } from "react";
import { Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { router } from "expo-router";

import { Chip } from "@/components/setup/Chip";
import { SelectSheet } from "@/components/setup/SelectSheet";
import { SetupField } from "@/components/setup/SetupField";
import { SetupScreen } from "@/components/setup/SetupScreen";
import { activityOptions, healthFlagOptions } from "@/data/setup";
import { useSetupStore } from "@/store/setup";
import { colors } from "@/theme";

// Keeps only digits (and one decimal point when allowed)
const toNumberText = (text: string, decimals = false) =>
  decimals ? text.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 5) : text.replace(/\D/g, "").slice(0, 3);

const inRange = (value: string, min: number, max: number) => {
  const n = Number(value);
  return value !== "" && n >= min && n <= max;
};

export default function BodyDetails() {
  const { profile, update, toggleHealthFlag, report } = useSetupStore();
  const [isActivityOpen, setIsActivityOpen] = useState(false);

  const activity = activityOptions.find((a) => a.id === profile.activity);
  const canContinue =
    inRange(profile.heightCm, 100, 250) &&
    inRange(profile.weightKg, 30, 300) &&
    (profile.bodyFatPercent === "" || inRange(profile.bodyFatPercent, 3, 70)) &&
    profile.activity !== null;

  return (
    <SetupScreen
      step="body"
      title="Tell us about your body"
      subtitle="This helps us calculate your nutrition needs accurately."
      onNext={() => router.push("/setup/food")}
      canContinue={canContinue}
    >
      <View className="gap-3">
        <SetupField
          label="Height"
          icon={{ ios: "ruler", android: "height", web: "height" }}
          unit="cm"
          placeholder="170"
          value={profile.heightCm}
          onChangeText={(text) => update({ heightCm: toNumberText(text) })}
          keyboardType="number-pad"
        />
        <SetupField
          label="Current weight"
          icon={{ ios: "scalemass", android: "scale", web: "scale" }}
          unit="kg"
          placeholder="70"
          value={profile.weightKg}
          onChangeText={(text) => update({ weightKg: toNumberText(text, true) })}
          keyboardType="decimal-pad"
        />
        {report ? (
          <View className="setup__info">
            <SymbolView name={{ ios: "doc.text.fill", android: "description", web: "description" }} size={16} tintColor={colors.forest} />
            <Text className="setup__card-text flex-1">
              Using the body fat values from your body composition report.
            </Text>
          </View>
        ) : (
          <SetupField
            label="Body fat % (optional)"
            icon={{ ios: "percent", android: "percent", web: "percent" }}
            unit="%"
            placeholder="Only if you've had it measured"
            value={profile.bodyFatPercent}
            onChangeText={(text) => update({ bodyFatPercent: toNumberText(text, true) })}
            keyboardType="decimal-pad"
          />
        )}
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
              tintColor={colors.forest}
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
