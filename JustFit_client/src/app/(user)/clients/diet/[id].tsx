import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Redirect, router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { FieldInput } from "@/components/FieldInput";
import { FormAlert } from "@/components/FormAlert";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";
import { PressableScale } from "@/components/PressableScale";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { DietMealPicker } from "@/components/trainer/DietMealPicker";
import { dietPlanApi, type DietMealInput, type TrainerDietView } from "@/lib/dietPlanApi";
import { DIET_SLOTS, MAX_DIET_MEALS, MAX_DIET_PICKS, sharedFoodText, type DietSlot } from "@/lib/dietPlanText";
import { hud } from "@/lib/hud";
import { confirmChoice } from "@/lib/nativeSheets";
import { useSessionToken } from "@/lib/session";
import { useAuthStore } from "@/store/auth";
import { useThemeColors } from "@/theme";

// A meal while it's typed: numbers and the time stay text until Save
type DraftMeal = { key: string; slot: DietSlot; time: string; food: string; kcal: string; proteinG: string; picks: string[] };
let nextKey = 0;
const draftOf = (m?: DietMealInput): DraftMeal => ({
  key: `m${nextKey++}`,
  slot: m?.slot ?? "lunch",
  time: m?.time ?? "",
  food: m?.food ?? "",
  kcal: m?.kcal === null || m?.kcal === undefined ? "" : String(m.kcal),
  proteinG: m?.proteinG === null || m?.proteinG === undefined ? "" : String(m.proteinG),
  picks: m?.picks ?? [],
});
const digits = (t: string, max: number) => t.replace(/\D/g, "").slice(0, max);
const orderable = (slot: DietSlot) => DIET_SLOTS.find((s) => s.id === slot)?.orderable ?? false;

export default function ClientDietPlanRoute() {
  const trainer = useAuthStore((state) => state.user?.role === "trainer");
  return trainer ? <ClientDietPlan /> : <Redirect href="/home" />;
}

// A trainer's diet plan for one PT client (2026-11-10): one day of meals (it repeats until
// changed), each with what to eat and optional kcal and protein, and for breakfast, lunch and
// dinner up to three justFit meals to recommend, which the client can order from their Meal Plan.
// The client's diet and allergies show only when they chose to share them; the server checks the
// picks against them again on save.
function ClientDietPlan() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const getToken = useSessionToken();
  const { id } = useLocalSearchParams<{ id: string }>();
  const memberId = Number(id);
  const [view, setView] = useState<TrainerDietView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [meals, setMeals] = useState<DraftMeal[]>([]);
  const [picking, setPicking] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const answer = await dietPlanApi.forTrainer(await getToken().catch(() => null), memberId);
    if (!answer.ok) return setLoadError(answer.error);
    setView(answer.data);
    setNote(answer.data.plan?.note ?? "");
    setMeals(answer.data.plan ? answer.data.plan.meals.map(draftOf) : [draftOf({ slot: "breakfast", time: "08:00", food: "", kcal: null, proteinG: null, picks: [] }), draftOf({ slot: "lunch", time: "13:30", food: "", kcal: null, proteinG: null, picks: [] }), draftOf({ slot: "dinner", time: "20:00", food: "", kcal: null, proteinG: null, picks: [] })]);
  }, [getToken, memberId]);
  useFocusEffect(useCallback(() => { if (!view) load(); }, [load, view]));

  const change = (key: string, patch: Partial<DraftMeal>) =>
    setMeals((list) => list.map((m) => (m.key === key ? { ...m, ...patch, picks: patch.slot && !orderable(patch.slot) ? [] : patch.picks ?? m.picks } : m)));
  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: "/clients/[id]", params: { id: String(memberId) } }));
  const mealName = (mealId: string) => view?.menu.find((m) => m.id === mealId)?.name ?? "A meal no longer on the menu";

  const save = async () => {
    if (saving) return;
    setError(null);
    const filled = meals.filter((m) => m.food.trim());
    if (filled.length === 0) return setError("Write what they eat for at least one meal.");
    const time = filled.find((m) => m.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(m.time));
    if (time) return setError(`Write the time as HH:MM, like 08:00 or 13:30 (${time.time}).`);
    setSaving(true);
    const body = {
      note: note.trim() || null,
      meals: filled.map((m) => ({ slot: m.slot, time: m.time || null, food: m.food.trim(), kcal: m.kcal ? Number(m.kcal) : null, proteinG: m.proteinG ? Number(m.proteinG) : null, picks: orderable(m.slot) ? m.picks : [] })),
    };
    const answer = await dietPlanApi.save(await getToken().catch(() => null), memberId, body);
    setSaving(false);
    if (!answer.ok) return setError(answer.error);
    hud.success(view?.plan ? "Diet plan updated" : "Diet plan shared");
    back();
  };

  const remove = async () => {
    const ok = await confirmChoice({ title: "Remove this diet plan?", message: `${view?.client.name ?? "Your client"} won't see it any more.`, confirmLabel: "Remove plan", destructive: true });
    if (!ok) return;
    const answer = await dietPlanApi.remove(await getToken().catch(() => null), memberId);
    if (!answer.ok) return setError(answer.error);
    hud.success("Diet plan removed");
    back();
  };

  const pickingMeal = meals.find((m) => m.key === picking) ?? null;

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScreenHeader title="Diet plan" subtitle={view?.client.name} onBack={back} />
        <KeyboardAvoider>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom, gap: 16 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
            {!view && !loadError && <ScreenSkeleton label="Loading the diet plan" />}
            {loadError && (
              <View style={{ gap: 12 }}>
                <FormAlert message={loadError} />
                <PrimaryButton label="Try again" onPress={load} />
              </View>
            )}
            {view && (
              <>
                <View className="card" style={{ gap: 4 }}>
                  <Text className="type-overline text-muted">Their food</Text>
                  {view.shared ? (
                    <Text className="type-body text-ink">{sharedFoodText(view.food)}</Text>
                  ) : (
                    <Text className="meta-text">{`${view.client.name} hasn't shared their diet and allergies. justFit hides any meal you pick that doesn't suit them.`}</Text>
                  )}
                </View>

                {meals.map((meal, index) => (
                  <View key={meal.key} className="card" style={{ gap: 10 }}>
                    <View className="flex-row items-center justify-between">
                      <Text className="card__title">{`Meal ${index + 1}`}</Text>
                      {meals.length > 1 && (
                        <Pressable onPress={() => setMeals((list) => list.filter((m) => m.key !== meal.key))} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove meal ${index + 1}`}>
                          <Text className="meal-link" style={{ color: colors.danger }}>Remove</Text>
                        </Pressable>
                      )}
                    </View>
                    <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                      {DIET_SLOTS.map((s) => (
                        <PressableScale key={s.id} haptic="select" onPress={() => change(meal.key, { slot: s.id })} className={meal.slot === s.id ? "meal-chip meal-chip--on" : "meal-chip"} accessibilityRole="button" accessibilityState={{ selected: meal.slot === s.id }} accessibilityLabel={`Meal time: ${s.label}`}>
                          <Text className={meal.slot === s.id ? "admin-segment__label admin-segment__label--on" : "admin-segment__label"}>{s.label}</Text>
                        </PressableScale>
                      ))}
                    </View>
                    <View className="setup__field">
                      <FieldInput className="min-w-0 flex-1" value={meal.food} onChangeText={(t) => change(meal.key, { food: t.slice(0, 160) })} placeholder="What to eat: 3 idli + sambar, 1 boiled egg" placeholderTextColor={colors.faint} multiline accessibilityLabel={`Meal ${index + 1}: what to eat`} />
                    </View>
                    <View className="flex-row" style={{ gap: 8 }}>
                      <View className="setup__field flex-1">
                        <FieldInput className="min-w-0 flex-1" value={meal.time} onChangeText={(t) => change(meal.key, { time: t.replace(/[^\d:]/g, "").slice(0, 5) })} placeholder="08:00" placeholderTextColor={colors.faint} keyboardType="numbers-and-punctuation" accessibilityLabel={`Meal ${index + 1}: time`} />
                      </View>
                      <View className="setup__field flex-1">
                        <FieldInput className="min-w-0 flex-1" value={meal.kcal} onChangeText={(t) => change(meal.key, { kcal: digits(t, 4) })} placeholder="kcal" placeholderTextColor={colors.faint} keyboardType="number-pad" accessibilityLabel={`Meal ${index + 1}: kcal`} />
                      </View>
                      <View className="setup__field flex-1">
                        <FieldInput className="min-w-0 flex-1" value={meal.proteinG} onChangeText={(t) => change(meal.key, { proteinG: digits(t, 3) })} placeholder="Protein g" placeholderTextColor={colors.faint} keyboardType="number-pad" accessibilityLabel={`Meal ${index + 1}: protein in grams`} />
                      </View>
                    </View>
                    {orderable(meal.slot) && (
                      <View style={{ gap: 8 }}>
                        <Text className="type-overline text-muted">Recommend from justFit</Text>
                        {meal.picks.map((pick) => (
                          <View key={pick} className="flex-row items-center" style={{ gap: 8 }}>
                            <SymbolView name={{ ios: "star.fill", android: "star", web: "star" }} size={14} tintColor={colors.warning} />
                            <Text className="type-body text-ink flex-1" numberOfLines={1}>{mealName(pick)}</Text>
                            <Pressable onPress={() => change(meal.key, { picks: meal.picks.filter((p) => p !== pick) })} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${mealName(pick)}`}>
                              <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={14} tintColor={colors.faint} />
                            </Pressable>
                          </View>
                        ))}
                        {meal.picks.length < MAX_DIET_PICKS && (
                          <Pressable onPress={() => setPicking(meal.key)} className="self-start" hitSlop={8} accessibilityRole="button">
                            <Text className="meal-link">+ Pick a justFit meal</Text>
                          </Pressable>
                        )}
                      </View>
                    )}
                  </View>
                ))}

                {meals.length < MAX_DIET_MEALS && (
                  <Pressable onPress={() => setMeals((list) => [...list, draftOf({ slot: "evening", time: null, food: "", kcal: null, proteinG: null, picks: [] })])} className="btn-outline flex-row" style={{ gap: 8 }} accessibilityRole="button">
                    <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={16} tintColor={colors.leaf} />
                    <Text className="btn-outline__label">Add a meal</Text>
                  </Pressable>
                )}

                <View style={{ gap: 6 }}>
                  <Text className="setup__section">A note for them (optional)</Text>
                  <View className="setup__field">
                    <FieldInput className="min-w-0 flex-1" value={note} onChangeText={(t) => setNote(t.slice(0, 300))} placeholder="Drink 3 L water, no sugar in tea" placeholderTextColor={colors.faint} multiline accessibilityLabel="A note for your client" />
                  </View>
                </View>

                {error && <FormAlert message={error} />}
                <PrimaryButton label={view.plan ? "Save changes" : "Share the plan"} onPress={save} loading={saving} />
                {view.plan && (
                  <Pressable onPress={remove} className="self-center" hitSlop={10} accessibilityRole="button">
                    <Text className="meal-link" style={{ color: colors.danger }}>Remove plan</Text>
                  </Pressable>
                )}
              </>
            )}
          </ScrollView>
        </KeyboardAvoider>
      </SafeAreaView>
      {view && pickingMeal && (
        <DietMealPicker
          menu={view.menu}
          picked={pickingMeal.picks}
          kcal={pickingMeal.kcal ? Number(pickingMeal.kcal) : null}
          onPick={(mealId) => change(pickingMeal.key, { picks: [...pickingMeal.picks, mealId].slice(0, MAX_DIET_PICKS) })}
          onClose={() => setPicking(null)}
        />
      )}
    </View>
  );
}
