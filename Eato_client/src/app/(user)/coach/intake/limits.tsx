import { Text, TextInput, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";
import { router } from "expo-router";

import { Chip } from "@/components/setup/Chip";
import { IntakeFrame } from "@/components/coach/IntakeFrame";
import { conditions, joints } from "@/data/coach";
import { useCoachIntakeStore } from "@/store/coachIntake";
import { colors } from "@/theme";

// Intake 6/9: joints to protect, health conditions and notes. All optional; any condition
// shows the "check with a doctor" note and makes the coach cautious later on.
export default function IntakeLimits() {
  const { draft, update, toggle } = useCoachIntakeStore();

  return (
    <IntakeFrame step="limits" title="Anything to work around?" subtitle="Private to you. Skip anything that doesn't apply." onNext={() => router.push("/coach/intake/lifestyle")}>
      <View className="coach__card">
        <Text className="setup__section">Joints to protect</Text>
        <View className="flex-row flex-wrap gap-2">
          {joints.map((joint) => (
            <Chip key={joint.id} label={joint.label} selected={draft.joints.includes(joint.id)} onPress={() => toggle("joints", joint.id)} />
          ))}
        </View>
      </View>

      <View className="coach__card">
        <Text className="setup__section">Health conditions</Text>
        <View className="flex-row flex-wrap gap-2">
          {conditions.map((condition) => (
            <Chip key={condition.id} label={condition.label} selected={draft.conditions.includes(condition.id)} onPress={() => toggle("conditions", condition.id)} />
          ))}
        </View>
        {draft.conditions.length > 0 && (
          <View className="flex-row items-start gap-3 rounded-md bg-warning-soft p-3" accessibilityRole="alert">
            <SymbolView name={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} size={18} tintColor={colors.warning} />
            <View className="flex-1">
              <Text className="setup__note-title">Check with a doctor first</Text>
              <Text className="setup__note-text mt-0.5">Your coach will keep your plan as safe as possible.</Text>
            </View>
          </View>
        )}
      </View>

      <View className="coach__card">
        <Text className="setup__section">Injuries or notes</Text>
        <TextInput
          value={draft.limitationNotes}
          onChangeText={(text) => update({ limitationNotes: text.slice(0, 300) })}
          placeholder="e.g. Torn ACL in 2023, slipped disc"
          placeholderTextColor={colors.faint}
          multiline
          accessibilityLabel="Injuries or notes"
          style={{ minHeight: 88, padding: 12, borderRadius: 16, backgroundColor: colors.surfaceAlt, color: colors.forestInk, fontSize: 15, textAlignVertical: "top" }}
        />
      </View>
    </IntakeFrame>
  );
}
