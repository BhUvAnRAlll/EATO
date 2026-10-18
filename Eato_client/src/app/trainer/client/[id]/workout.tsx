import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { AdminScreen } from "@/components/admin/AdminScreen";
import { FormAlert } from "@/components/FormAlert";
import { todayIso } from "@/lib/macro";
import { weekdayLabels } from "@/lib/trainerRules";
import { trainers, type LibraryExercise, type WorkoutDraft } from "@/lib/trainers";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

const input = { height: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.creamLine, backgroundColor: colors.white, paddingHorizontal: 10, fontSize: 15, color: colors.forestInk } as const;
const goals = [["lose_weight", "Lose weight"], ["build_muscle", "Build muscle"], ["get_fitter", "Get fitter"], ["stay_healthy", "Stay healthy"]] as const;
const levels = [["beginner", "Beginner"], ["intermediate", "Intermediate"], ["advanced", "Advanced"]] as const;

type ExerciseForm = { exercise: LibraryExercise; sets: string; reps: string; rest: string };
type DayForm = { title: string; exercises: ExerciseForm[] };

// The trainer writes a client's workout: the training weekdays, a title for each, and
// exercises from the library with sets × reps (or seconds, for timed ones) and rest. Saving
// replaces the client's active plan, which their Fitness tab then shows.
export default function TrainerWorkoutEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const getToken = useSessionToken();
  const [library, setLibrary] = useState<LibraryExercise[] | null>(null);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState<WorkoutDraft["goal"]>("get_fitter");
  const [level, setLevel] = useState<WorkoutDraft["level"]>("beginner");
  const [note, setNote] = useState("");
  const [days, setDays] = useState<Record<number, DayForm>>({});
  const [picking, setPicking] = useState<number | null>(null); // the weekday an exercise is being added to
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (library) return;
    const result = await trainers.library(await getToken());
    if (result.ok) setLibrary(result.data.exercises);
    else setError(result.error);
  }, [library, getToken]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(load, 0);
      return () => clearTimeout(timer);
    }, [load]),
  );

  const toggleDay = (weekday: number) =>
    setDays((d) => {
      const next = { ...d };
      if (next[weekday]) delete next[weekday];
      else next[weekday] = { title: "", exercises: [] };
      return next;
    });
  const updateDay = (weekday: number, change: Partial<DayForm>) => setDays((d) => ({ ...d, [weekday]: { ...d[weekday], ...change } }));
  const updateExercise = (weekday: number, index: number, change: Partial<ExerciseForm>) =>
    updateDay(weekday, { exercises: days[weekday].exercises.map((e, i) => (i === index ? { ...e, ...change } : e)) });

  const addExercise = (exercise: LibraryExercise) => {
    if (picking === null) return;
    updateDay(picking, { exercises: [...days[picking].exercises, { exercise, sets: "3", reps: exercise.timedSec ? String(exercise.timedSec) : "10", rest: "60" }] });
    setPicking(null);
    setSearch("");
  };

  const save = async () => {
    const weekdays = Object.keys(days).map(Number).sort();
    if (!name.trim()) return setError("Give the workout a name.");
    if (weekdays.length === 0) return setError("Pick at least one training day.");
    const draftDays: WorkoutDraft["days"] = [];
    for (const weekday of weekdays) {
      const day = days[weekday];
      if (!day.title.trim()) return setError(`${weekdayLabels[weekday]}: give the day a title.`);
      if (day.exercises.length === 0) return setError(`${weekdayLabels[weekday]}: add at least one exercise.`);
      const exercises = [];
      for (const e of day.exercises) {
        const sets = Number(e.sets), amount = Number(e.reps), rest = Number(e.rest);
        if (!Number.isInteger(sets) || sets < 1 || sets > 10) return setError(`${e.exercise.name}: sets must be 1 to 10.`);
        if (!Number.isInteger(amount) || amount < 1) return setError(`${e.exercise.name}: write the ${e.exercise.timedSec ? "seconds" : "reps"}.`);
        if (!Number.isInteger(rest) || rest < 0 || rest > 600) return setError(`${e.exercise.name}: rest must be 0 to 600 seconds.`);
        const set = e.exercise.timedSec ? { durationSec: amount } : { reps: amount };
        exercises.push({ exerciseId: e.exercise.id, sets: Array.from({ length: sets }, () => set), restSec: rest });
      }
      draftDays.push({ weekday, title: day.title.trim(), exercises });
    }
    setSaving(true);
    setError(null);
    const result = await trainers.setWorkout(await getToken(), id, { today: todayIso(), name: name.trim(), goal, level, note: note.trim() || null, days: draftDays });
    setSaving(false);
    if (!result.ok) return setError(result.error);
    router.back();
  };

  const matches = (library ?? []).filter((e) => !search.trim() || `${e.name} ${e.muscleGroup}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 30);
  const chip = (selected: boolean, label: string, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} className={selected ? "setup__chip setup__chip--selected" : "setup__chip"} accessibilityRole="radio" accessibilityState={{ selected }}>
      <Text className={selected ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{label}</Text>
    </Pressable>
  );

  return (
    <AdminScreen title="Workout" subtitle="Saving replaces your client's current workout. They see it on their Fitness tab.">
      <View className="gap-3">
        <TextInput value={name} onChangeText={setName} placeholder="Workout name" placeholderTextColor={colors.faint} maxLength={80} accessibilityLabel="Workout name" style={input} />
        <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">{goals.map(([value, label]) => chip(goal === value, label, () => setGoal(value)))}</View>
        <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">{levels.map(([value, label]) => chip(level === value, label, () => setLevel(value)))}</View>
        <TextInput value={note} onChangeText={setNote} placeholder="Note to your client about this change (optional)" placeholderTextColor={colors.faint} maxLength={300} accessibilityLabel="Note to your client" style={input} />
        <Text className="setup__section">Training days</Text>
        <View className="flex-row flex-wrap gap-2">{weekdayLabels.map((label, weekday) => chip(Boolean(days[weekday]), label, () => toggleDay(weekday)))}</View>
        {Object.keys(days).map(Number).sort().map((weekday) => (
          <View key={weekday} className="post__card gap-2">
            <Text className="setup__section">{weekdayLabels[weekday]}</Text>
            <TextInput value={days[weekday].title} onChangeText={(v) => updateDay(weekday, { title: v })} placeholder="Upper body" placeholderTextColor={colors.faint} maxLength={60} accessibilityLabel={`${weekdayLabels[weekday]} title`} style={input} />
            {days[weekday].exercises.map((e, i) => (
              <View key={`${e.exercise.id}-${i}`} className="gap-1">
                <View className="flex-row items-center justify-between">
                  <Text className="post__author flex-1" numberOfLines={1}>{e.exercise.name}</Text>
                  <Pressable onPress={() => updateDay(weekday, { exercises: days[weekday].exercises.filter((_, j) => j !== i) })} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${e.exercise.name}`}>
                    <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={14} tintColor={colors.muted} />
                  </Pressable>
                </View>
                <View className="flex-row gap-2">
                  {([["sets", "Sets"], ["reps", e.exercise.timedSec ? "Seconds" : "Reps"], ["rest", "Rest s"]] as const).map(([key, label]) => (
                    <View key={key} className="min-w-0 flex-1">
                      <Text className="post__time">{label}</Text>
                      <TextInput value={e[key]} onChangeText={(v) => updateExercise(weekday, i, { [key]: v.replace(/[^0-9]/g, "") })} keyboardType="number-pad" maxLength={4} accessibilityLabel={`${e.exercise.name} ${label}`} style={input} />
                    </View>
                  ))}
                </View>
              </View>
            ))}
            {picking === weekday ? (
              <View className="gap-2">
                <TextInput value={search} onChangeText={setSearch} placeholder="Search the exercise library" placeholderTextColor={colors.faint} autoCorrect={false} autoFocus accessibilityLabel="Search exercises" style={input} />
                {library === null ? <ActivityIndicator color={colors.forest} /> : matches.map((e) => (
                  <Pressable key={e.id} onPress={() => addExercise(e)} className="py-1.5" accessibilityRole="button" accessibilityLabel={`Add ${e.name}`}>
                    <Text className="post__body">{e.name}</Text>
                    <Text className="post__time">{e.muscleGroup.replace(/_/g, " ")}{e.timedSec ? " · timed" : ""}</Text>
                  </Pressable>
                ))}
                <Pressable onPress={() => setPicking(null)} className="self-start" accessibilityRole="button"><Text className="home__note">Cancel</Text></Pressable>
              </View>
            ) : (
              <Pressable onPress={() => setPicking(weekday)} className="admin__action self-start" accessibilityRole="button" accessibilityLabel={`Add exercise to ${weekdayLabels[weekday]}`}>
                <Text className="admin__action-label">Add exercise</Text>
              </Pressable>
            )}
          </View>
        ))}
        {error && <FormAlert message={error} />}
        <Pressable onPress={save} disabled={saving} className="btn-forest" style={{ opacity: saving ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Send updated workout">
          {saving ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">Send workout</Text>}
        </Pressable>
      </View>
    </AdminScreen>
  );
}
