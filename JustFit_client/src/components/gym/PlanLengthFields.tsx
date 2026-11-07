import { GymField } from "@/components/gym/GymField";
import { PLAN_MAX_MONTHS } from "@/lib/gymDates";
import { useThemeColors } from "@/theme";

// A plan's or PT package's length: the Duration in whole months (from the Add Plan design). The
// Duration Type chips (Months or Days) went on 2026-11-07, the user's request: plans are months
// only. `duration` is the typed text; durationValue() reads it.
export function PlanLengthFields({ duration, onDuration }: { duration: string; onDuration: (text: string) => void }) {
  const colors = useThemeColors();
  return (
    <GymField
      label="Duration"
      icon="timer"
      value={duration}
      onChangeText={(t) => onDuration(t.replace(/\D/g, "").slice(0, 2))}
      keyboardType="number-pad"
      placeholder="Duration (Eg. 6)"
      hint={`1 to ${PLAN_MAX_MONTHS} months`}
      iconColor={colors.gymMuted}
    />
  );
}

// The typed duration as a number of months when it's 1 to 24, else null
export function durationValue(text: string): number | null {
  const n = Number.parseInt(text, 10);
  return Number.isInteger(n) && n >= 1 && n <= PLAN_MAX_MONTHS ? n : null;
}
