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
      <View className="coach__card">
        <View className="flex-row items-center justify-between">
          <Text className="setup__section">Which days</Text>
          <Text className="post__time">{count === 0 ? "Pick at least one" : `${count} day${count === 1 ? "" : "s"} a week`}</Text>
        </View>
        {/* Seven circles that shrink to fit narrow phones (40 pt at most) */}
        <View className="flex-row justify-between gap-1">
          {weekdayChoices.map((day) => {
            const selected = draft.weekdays.includes(day.id);
            return (
              <Pressable
                key={day.id}
                onPress={() => toggle("weekdays", day.id)}
                className={selected ? "coach__day coach__day--selected" : "coach__day"}
                style={{ flex: 1, maxWidth: 40, aspectRatio: 1 }}
                accessibilityRole="checkbox"
                aria-checked={selected}
                accessibilityLabel={day.label}
              >
                <Text className={selected ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{day.label.slice(0, 2)}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View className="coach__card">
        <Text className="setup__section">Session length</Text>
        <View className="flex-row flex-wrap gap-2">
          {sessionLengths.map((length) => {
            const selected = draft.sessionMinutes === length.id;
            return (
              // Three a row; less side padding than a setup chip so "75+ min" stays on one line
              <Pressable
                key={length.id}
                onPress={() => update({ sessionMinutes: length.id })}
                className={selected ? "setup__chip setup__chip--selected basis-1/4 flex-1" : "setup__chip basis-1/4 flex-1"}
                style={{ paddingHorizontal: 4 }}
                accessibilityRole="radio"
                aria-checked={selected}
              >
                <Text numberOfLines={1} className={selected ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{length.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </IntakeFrame>
  );
}
