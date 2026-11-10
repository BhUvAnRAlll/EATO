import { Text, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";
import { router } from "expo-router";

import { CoachChip } from "@/components/coach/CoachChip";
import { CoachTextArea } from "@/components/coach/CoachTextArea";
import { IntakeFrame } from "@/components/coach/IntakeFrame";
import { conditions, joints } from "@/data/coach";
import { healthFlagOptionsFor } from "@/data/setup";
import { useCoachIntakeStore } from "@/store/coachIntake";
import { useThemeColors } from "@/theme";

// Intake 7/10: joints to protect, health conditions (with setup's old health check since
// 2026-11-10: pregnancy and breastfeeding, never for a man, eating disorder history, a condition
// affecting diet) and notes. All optional; any of them shows the "check with a doctor" note. The
// health-check ones also mean the calorie target comes from a doctor or dietitian, never the calculator.
export default function IntakeLimits() {
  const colors = useThemeColors();
  const { draft, update, toggle } = useCoachIntakeStore();

  return (
    <IntakeFrame step="limits" title="Anything to work around?" subtitle="Private to you. Skip anything that doesn't apply." onNext={() => router.push("/coach/intake/body")}>
      <View className="gap-3">
        <Text className="coach__section">Joints to protect</Text>
        <View className="flex-row flex-wrap gap-2.5">
          {joints.map((joint) => (
            <CoachChip key={joint.id} multi label={joint.label} selected={draft.joints.includes(joint.id)} onPress={() => toggle("joints", joint.id)} />
          ))}
        </View>
      </View>

      <View className="gap-3">
        <Text className="coach__section">Health conditions</Text>
        <View className="flex-row flex-wrap gap-2.5">
          {conditions.map((condition) => (
            <CoachChip key={condition.id} multi label={condition.label} selected={draft.conditions.includes(condition.id)} onPress={() => toggle("conditions", condition.id)} />
          ))}
          {healthFlagOptionsFor(draft.gender).map((flag) => (
            <CoachChip key={flag.id} multi label={flag.label} selected={draft.healthFlags.includes(flag.id)} onPress={() => toggle("healthFlags", flag.id)} />
          ))}
        </View>
        {(draft.conditions.length > 0 || draft.healthFlags.length > 0) && (
          <View className="flex-row items-start gap-3 rounded-md bg-warning-soft p-3" accessibilityRole="alert">
            <SymbolView name={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} size={18} tintColor={colors.warning} />
            <View className="flex-1">
              <Text className="setup__note-title">Check with a doctor first</Text>
              <Text className="setup__note-text mt-0.5">
                {draft.healthFlags.length > 0
                  ? "Your coach will keep your plan as safe as possible, and your calorie target should come from your doctor or dietitian."
                  : "Your coach will keep your plan as safe as possible."}
              </Text>
            </View>
          </View>
        )}
      </View>

      <View className="gap-3">
        <Text className="coach__section">Injuries or notes</Text>
        <CoachTextArea
          value={draft.limitationNotes}
          onChangeText={(text) => update({ limitationNotes: text.slice(0, 300) })}
          placeholder="e.g. Torn ACL in 2023, slipped disc"
          accessibilityLabel="Injuries or notes"
          minHeight={96}
        />
      </View>
    </IntakeFrame>
  );
}
