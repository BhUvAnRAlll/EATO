import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";

import { IntakeFrame } from "@/components/coach/IntakeFrame";
import { sessionLengths, weekdayChoices } from "@/data/coach";
import { useCoachIntakeStore } from "@/store/coachIntake";

// Intake 3/9: which days and how long. Days are stored 0 = Sunday, shown Monday first.
export default function IntakeSchedule() {
  const { draft, update, toggle } = useCoachIntakeStore();
  const count = draft.weekdays.length;

  return (
    <IntakeFrame
      step="schedule"
      title="How often can you train?"
      subtitle="You can change this anytime."
      onNext={() => router.push("/coach/intake/spots")}
      canContinue={count > 0 && draft.sessionMinutes !== null}
    >
      <View className="gap-3">
        <View className="flex-row items-center justify-between">
          <Text className="coach__section">Which days</Text>
          <Text className="coach__hint">{count === 0 ? "Pick at least one" : `${count} day${count === 1 ? "" : "s"} a week`}</Text>
        </View>
        {/* Seven circles that shrink to fit narrow phones (42 pt at most), red when picked */}
        <View className="flex-row justify-between gap-1">
          {weekdayChoices.map((day) => {
            const selected = draft.weekdays.includes(day.id);
            return (
              <Pressable
                key={day.id}
                onPress={() => toggle("weekdays", day.id)}
                className={selected ? "coach__day coach__day--selected" : "coach__day"}
                style={{ flex: 1, maxWidth: 42, aspectRatio: 1 }}
                accessibilityRole="checkbox"
                aria-checked={selected}
                accessibilityLabel={day.label}
              >
                <Text className={selected ? "coach__day-label coach__day-label--selected" : "coach__day-label"}>{day.label.slice(0, 2)}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View className="gap-3">
        <Text className="coach__section">Session length</Text>
        <View className="flex-row flex-wrap gap-2.5">
          {sessionLengths.map((length) => {
            const selected = draft.sessionMinutes === length.id;
            return (
              // Three a row, so "75+ min" stays on one line
              <Pressable
                key={length.id}
                onPress={() => update({ sessionMinutes: length.id })}
                className={selected ? "coach__chip coach__chip--selected basis-1/4 flex-1" : "coach__chip basis-1/4 flex-1"}
                accessibilityRole="radio"
                aria-checked={selected}
              >
                <Text numberOfLines={1} className={selected ? "coach__chip-label coach__chip-label--selected" : "coach__chip-label"}>{length.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </IntakeFrame>
  );
}
