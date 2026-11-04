import { Text, View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { GymField } from "@/components/gym/GymField";
import { GradientFill } from "@/components/gym/GradientFill";
import { PLAN_LIMIT } from "@/data/gymDashboard";
import type { PlanUnit } from "@/lib/gymApi";
import { haptic } from "@/lib/haptics";
import { useThemeColors } from "@/theme";

// A plan's length: Duration Type (Months or Days) and the Duration (from the Add Plan design).
// `duration` is the typed text; durationValue() reads it.
export function PlanLengthFields({ unit, onUnit, duration, onDuration }: { unit: PlanUnit; onUnit: (unit: PlanUnit) => void; duration: string; onDuration: (text: string) => void }) {
  const colors = useThemeColors();
  return (
    <>
      <View className="flex-row items-center" style={{ gap: 10 }} accessibilityRole="radiogroup">
        <Text className="gym-field__label" style={{ fontSize: 14 }}>Duration Type</Text>
        {(["months", "days"] as const).map((u) => {
          const selected = u === unit;
          return (
            <PressableScale key={u} onPress={() => { if (!selected) haptic.select(); onUnit(u); }} className={selected ? "gym-kind gym-kind--selected" : "gym-kind"} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={u === "months" ? "Months" : "Days"}>
              {selected && <GradientFill radius={999} />}
              <Text className={selected ? "gym-kind__label gym-kind__label--selected" : "gym-kind__label"}>{u === "months" ? "Months" : "Days"}</Text>
            </PressableScale>
          );
        })}
      </View>
      <GymField
        label="Duration"
        icon={{ ios: "timer", android: "timer", web: "timer" }}
        value={duration}
        onChangeText={(t) => onDuration(t.replace(/\D/g, "").slice(0, 3))}
        keyboardType="number-pad"
        placeholder={`Duration (Eg. ${unit === "months" ? 6 : 15})`}
        hint={`1 to ${PLAN_LIMIT[unit]} ${unit}`}
        iconColor={colors.gymMuted}
      />
    </>
  );
}

// The typed duration as a number when it's within the unit's range, else null
export function durationValue(text: string, unit: PlanUnit): number | null {
  const n = Number.parseInt(text, 10);
  return Number.isInteger(n) && n >= 1 && n <= PLAN_LIMIT[unit] ? n : null;
}
