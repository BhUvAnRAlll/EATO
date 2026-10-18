import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { AdminScreen } from "@/components/admin/AdminScreen";
import { PostSkeleton } from "@/components/community/CommunityStates";
import { FormAlert } from "@/components/FormAlert";
import { todayIso } from "@/lib/macro";
import { foodsText, mealSlotLabels, mealSlots, parseFoods, planGoalLabels, scaledTotals, type MealSlot, type PlanGoal } from "@/lib/trainerRules";
import { trainers, type DietPlanDraft } from "@/lib/trainers";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

const input = { borderRadius: 14, borderWidth: 1, borderColor: colors.creamLine, backgroundColor: colors.white, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.forestInk } as const;
const defaultTimes: Record<MealSlot, string> = { breakfast: "08:00", morning_snack: "11:00", lunch: "13:30", evening_snack: "17:00", dinner: "20:30" };

type MealForm = { name: string; time: string; note: string; foods: string };

// The trainer writes (or replaces) a client's diet plan: a name, goal and dates, then the five
// meals. Each meal's foods are one per line, "name | quantity unit | kcal | protein | carbs |
// fat", so the editor stays a few text boxes. Saving replaces the client's active plan.
export default function TrainerPlanEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const getToken = useSessionToken();
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState<PlanGoal>("maintenance");
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [meals, setMeals] = useState<Record<MealSlot, MealForm>>(() => Object.fromEntries(mealSlots.map((s) => [s, { name: "", time: defaultTimes[s], note: "", foods: "" }])) as Record<MealSlot, MealForm>);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start from the client's current plan, if any
  const load = useCallback(async () => {
    if (loaded) return;
    const result = await trainers.client(await getToken(), id);
    if (!result.ok) return setError(result.error);
    const plan = result.data.client.dietPlan;
    if (plan) {
      setName(plan.name);
      setGoal(plan.goal);
      setNotes(plan.notes ?? "");
      setEndDate(plan.endDate ?? "");
      setMeals((current) => {
        const next = { ...current };
        for (const meal of plan.meals) next[meal.slot] = { name: meal.name, time: meal.time, note: meal.note ?? "", foods: foodsText(meal.items) };
        return next;
      });
    }
    setLoaded(true);
  }, [loaded, id, getToken]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(load, 0);
      return () => clearTimeout(timer);
    }, [load]),
  );

  const setMeal = (slot: MealSlot, key: keyof MealForm, value: string) => setMeals((m) => ({ ...m, [slot]: { ...m[slot], [key]: value } }));

  const save = async () => {
    if (!name.trim()) return setError("Give the plan a name.");
    const draftMeals: DietPlanDraft["meals"] = [];
    for (const slot of mealSlots) {
      const meal = meals[slot];
      const { foods, errors } = parseFoods(meal.foods);
      if (!meal.name.trim()) return setError(`${mealSlotLabels[slot]}: give the meal a name.`);
      if (errors.length > 0) return setError(`${mealSlotLabels[slot]}: ${errors[0]}`);
      if (foods.length === 0) return setError(`${mealSlotLabels[slot]}: add at least one food.`);
      draftMeals.push({ slot, name: meal.name.trim(), time: meal.time, note: meal.note.trim() || null, items: foods });
    }
    setSaving(true);
    setError(null);
    const result = await trainers.setDietPlan(await getToken(), id, { name: name.trim(), goal, startDate, endDate: endDate.trim() || null, notes: notes.trim() || null, meals: draftMeals });
    setSaving(false);
    if (!result.ok) return setError(result.error);
    router.back();
  };

  if (!loaded && !error) return <AdminScreen title="Diet plan"><PostSkeleton /></AdminScreen>;

  return (
    <AdminScreen title="Diet plan" subtitle="Saving replaces your client's current plan. They see it under My Trainer → Diet Plan.">
      <View className="gap-3">
        <Text className="auth__label">Plan name</Text>
        <TextInput value={name} onChangeText={setName} placeholder="Lean phase" placeholderTextColor={colors.faint} maxLength={80} accessibilityLabel="Plan name" style={input} />
        <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
          {(Object.keys(planGoalLabels) as PlanGoal[]).map((g) => (
            <Pressable key={g} onPress={() => setGoal(g)} className={goal === g ? "setup__chip setup__chip--selected" : "setup__chip"} accessibilityRole="radio" accessibilityState={{ selected: goal === g }}>
              <Text className={goal === g ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{planGoalLabels[g]}</Text>
            </Pressable>
          ))}
        </View>
        <View className="flex-row gap-2">
          <View className="min-w-0 flex-1">
            <Text className="post__time mb-1">Starts</Text>
            <TextInput value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.faint} maxLength={10} accessibilityLabel="Start date" style={input} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="post__time mb-1">Ends (optional)</Text>
            <TextInput value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.faint} maxLength={10} accessibilityLabel="End date" style={input} />
          </View>
        </View>
        <TextInput value={notes} onChangeText={setNotes} placeholder="Notes for your client (optional)" placeholderTextColor={colors.faint} multiline maxLength={1000} accessibilityLabel="Plan notes" style={{ ...input, minHeight: 72, textAlignVertical: "top" }} />
        <Text className="home__note">Foods: one per line, written as name | quantity unit | kcal | protein | carbs | fat. For example: Oats | 60 g | 230 | 8 | 40 | 4</Text>
        {mealSlots.map((slot) => {
          const parsed = parseFoods(meals[slot].foods);
          const totals = scaledTotals(parsed.foods, []);
          return (
            <View key={slot} className="post__card gap-2">
              <Text className="setup__section">{mealSlotLabels[slot]}</Text>
              <View className="flex-row gap-2">
                <TextInput value={meals[slot].name} onChangeText={(v) => setMeal(slot, "name", v)} placeholder="Meal name" placeholderTextColor={colors.faint} maxLength={120} accessibilityLabel={`${mealSlotLabels[slot]} name`} style={{ ...input, flex: 1, minWidth: 0 }} />
                <TextInput value={meals[slot].time} onChangeText={(v) => setMeal(slot, "time", v)} placeholder="HH:MM" placeholderTextColor={colors.faint} maxLength={5} accessibilityLabel={`${mealSlotLabels[slot]} time`} style={{ ...input, width: 76 }} />
              </View>
              <TextInput value={meals[slot].foods} onChangeText={(v) => setMeal(slot, "foods", v)} placeholder="Oats | 60 g | 230 | 8 | 40 | 4" placeholderTextColor={colors.faint} multiline autoCapitalize="none" accessibilityLabel={`${mealSlotLabels[slot]} foods`} style={{ ...input, minHeight: 84, textAlignVertical: "top" }} />
              {parsed.errors.length > 0 ? (
                <Text className="home__note" style={{ color: colors.danger }}>{parsed.errors[0]}</Text>
              ) : parsed.foods.length > 0 ? (
                <Text className="home__note">{`${Math.round(totals.kcal)} kcal · P ${totals.proteinG} g · C ${totals.carbsG} g · F ${totals.fatG} g`}</Text>
              ) : null}
              <TextInput value={meals[slot].note} onChangeText={(v) => setMeal(slot, "note", v)} placeholder="Note (optional)" placeholderTextColor={colors.faint} maxLength={300} accessibilityLabel={`${mealSlotLabels[slot]} note`} style={input} />
            </View>
          );
        })}
        {error && <FormAlert message={error} />}
        <Pressable onPress={save} disabled={saving} className="btn-forest" style={{ opacity: saving ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Save diet plan">
          {saving ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">Save plan</Text>}
        </Pressable>
      </View>
    </AdminScreen>
  );
}
