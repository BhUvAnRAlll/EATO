import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";

import { Chip } from "@/components/setup/Chip";
import { OptionCard } from "@/components/setup/OptionCard";
import { RecreateField, RecreateFrame, tap } from "@/components/workout/RecreateFrame";
import { useRecreateDraft } from "@/components/workout/RecreateDraft";
import { FITNESS_STATEMENTS, PACES, RECREATE_GOALS } from "@/data/recreate";
import { DAY_CHOICES, MONDAY_FIRST, goalsErrors, toggleWeekday, withDayCount, type Draft, type Errors } from "@/lib/recreateRules";
import { shortDay } from "@/lib/workoutApi";

// Rebuild my plan, step 2 of 3: the goal, how many days and which ones, the pace, and a
// statement about current fitness

export default function RecreateGoals() {
  const { draft, update } = useRecreateDraft();
  const [errors, setErrors] = useState<Errors>({});
  const [tried, setTried] = useState(false);

  const set = (change: (d: Draft) => Draft) => {
    tap();
    const next = change(draft);
    update(() => next);
    if (tried) setErrors(goalsErrors(next));
  };
  const next = () => {
    const found = goalsErrors(draft);
    setTried(true);
    setErrors(found);
    if (Object.keys(found).length === 0) router.push("/workout/recreate/performance");
  };
  const target = draft.daysPerWeek;

  return (
    <RecreateFrame step={2} title="Goals & experience" subtitle="What you're training for, how often, and how fast you want to move." primaryLabel="Continue" onPrimary={next}>
      <RecreateField index={0} label="Fitness goal" error={errors.goal}>
        <View className="gap-2.5">
          {RECREATE_GOALS.map((g) => (
            <OptionCard key={g.value} label={g.label} selected={draft.goal === g.value} onPress={() => set((d) => ({ ...d, goal: g.value }))} />
          ))}
        </View>
      </RecreateField>

      <RecreateField index={1} label="Workout days" hint="days a week" error={errors.daysPerWeek}>
        <View className="flex-row gap-2">
          {DAY_CHOICES.map((n) => (
            <Chip key={n} grow label={String(n)} selected={target === n} onPress={() => set((d) => withDayCount(d, n))} />
          ))}
        </View>
      </RecreateField>

      <RecreateField index={2} label="Selected weekdays" hint={`${draft.weekdays.length} of ${target ?? "–"} chosen`} error={errors.weekdays}>
        <View className="flex-row gap-1.5">
          {MONDAY_FIRST.map((day) => (
            <Chip key={day} grow label={shortDay(day).slice(0, 2)} selected={draft.weekdays.includes(day)} onPress={() => set((d) => toggleWeekday(d, day))} />
          ))}
        </View>
      </RecreateField>

      <RecreateField index={3} label="Pace" error={errors.pace}>
        <View className="gap-2.5">
          {PACES.map((p) => (
            <OptionCard key={p.value} label={p.label} description={draft.goal === "lose_weight" ? p.loss : undefined} selected={draft.pace === p.value} onPress={() => set((d) => ({ ...d, pace: p.value }))} />
          ))}
        </View>
      </RecreateField>

      <RecreateField index={4} label="Current fitness level" error={errors.fitnessBase}>
        <View className="gap-2.5">
          {FITNESS_STATEMENTS.map((f) => (
            <OptionCard key={f.value} label={f.label} description={f.note} selected={draft.fitnessBase === f.value} onPress={() => set((d) => ({ ...d, fitnessBase: f.value }))} />
          ))}
        </View>
      </RecreateField>
    </RecreateFrame>
  );
}
