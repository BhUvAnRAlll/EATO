import { useCallback, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useLocalSearchParams } from "expo-router";

import { AdminField, ChoiceChips } from "@/components/admin/AdminField";
import { FormAlert } from "@/components/FormAlert";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { useGymSave } from "@/lib/gymForm";
import { kitchenApi, type AdminMeal } from "@/lib/mealsApi";
import { useGymData } from "@/lib/useGymData";
import { subscriptionsApi, type MealPlan, type PlanInput } from "@/lib/subscriptionsApi";
import { useSwitchColors, useThemeColors } from "@/theme";

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/subscriptions/plans"));
const GOALS = [
  { value: "fat_loss", label: "Fat loss" },
  { value: "muscle_gain", label: "Muscle gain" },
  { value: "maintain", label: "Maintain" },
  { value: "custom", label: "Custom" },
] as const;
const MEALS = [{ value: "1", label: "1 (lunch)" }, { value: "2", label: "2 (lunch, dinner)" }, { value: "3", label: "3 (all three)" }] as const;
const digits = (t: string) => t.replace(/[^0-9]/g, "");

// Super Admin › Meal plans › Add / Edit (Meal Operations phase 5): name, short line, description,
// goal, meals a day, daily kcal and macros, water, what's included (one a line), up to 4 lengths
// with prices, the meals it rotates through, and whether members see it
export default function AdminPlanForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const loadPlans = useCallback(async (t: string | null) => {
    const [plans, meals] = await Promise.all([subscriptionsApi.adminPlans(t), kitchenApi.meals(t)]);
    if (!plans.ok) return plans;
    if (!meals.ok) return meals;
    return { ok: true as const, data: { plan: plans.data.plans.find((p) => String(p.id) === id) ?? null, meals: meals.data.meals } };
  }, [id]);
  const { result } = useGymData(loadPlans);
  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <Header title={id ? "Edit plan" : "Add plan"} />
        {result.state === "loading" && <View className="px-4"><ScreenSkeleton label="Loading" /></View>}
        {result.state === "failed" && <View className="px-4"><FormAlert message={result.error} /></View>}
        {result.state === "ready" && <PlanForm plan={result.data.plan} meals={result.data.meals} />}
      </SafeAreaView>
    </View>
  );
}

function Header({ title }: { title: string }) {
  const colors = useThemeColors();
  return (
    <View className="screen-bar">
      <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
        <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
      </Pressable>
      <Text className="screen-bar__title" accessibilityRole="header">{title}</Text>
      <View className="screen-bar__spacer" />
    </View>
  );
}

function PlanForm({ plan, meals }: { plan: MealPlan | null; meals: AdminMeal[] }) {
  const colors = useThemeColors();
  const switchColors = useSwitchColors();
  const [name, setName] = useState(plan?.name ?? "");
  const [tagline, setTagline] = useState(plan?.tagline ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [goal, setGoal] = useState<MealPlan["goal"]>(plan?.goal ?? "fat_loss");
  const [mealsPerDay, setMealsPerDay] = useState(String(plan?.mealsPerDay ?? 3));
  const [calories, setCalories] = useState(String(plan?.calories ?? ""));
  const [protein, setProtein] = useState(String(plan?.proteinG ?? ""));
  const [carbs, setCarbs] = useState(String(plan?.carbsG ?? ""));
  const [fat, setFat] = useState(String(plan?.fatG ?? ""));
  const [water, setWater] = useState(String(plan?.waterL ?? "3"));
  const [included, setIncluded] = useState((plan?.included ?? ["Personalized, macro-balanced meals", "Fresh & hygienic preparation", "Scheduled daily delivery"]).join("\n"));
  const [lengths, setLengths] = useState<{ days: string; price: string }[]>(
    plan ? plan.lengths.map((l) => ({ days: String(l.days), price: String(l.price) })) : [{ days: "7", price: "" }, { days: "28", price: "" }, { days: "90", price: "" }],
  );
  const [mealIds, setMealIds] = useState<string[]>(plan?.mealIds ?? []);
  const [active, setActive] = useState(plan?.active ?? true);
  const { busy, error, save } = useGymSave(() => back(), plan ? "Plan saved" : "Plan added");

  const filled = lengths.filter((l) => l.days && l.price);
  const n = (t: string) => Number(t);
  const ready = name.trim().length >= 3 && tagline.trim().length >= 3 && description.trim().length >= 10 && n(calories) >= 800 && protein !== "" && carbs !== "" && fat !== "" && filled.length > 0;
  const submit = () => {
    if (!ready || busy) return;
    const input: PlanInput = {
      name: name.trim(), tagline: tagline.trim(), description: description.trim(), goal, mealsPerDay: n(mealsPerDay), calories: n(calories), proteinG: n(protein),
      carbsG: n(carbs), fatG: n(fat), waterL: Number(water) || 0, included: included.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8),
      lengths: filled.map((l) => ({ days: n(l.days), price: n(l.price) })), mealIds, active, sortOrder: plan?.sortOrder ?? 0,
    };
    save((t) => (plan ? subscriptionsApi.editPlan(t, plan.id, input) : subscriptionsApi.addPlan(t, input)));
  };

  return (
    <KeyboardAvoider>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}>
        <AdminField label="Plan name" value={name} onChangeText={setName} maxLength={40} placeholder="Fat Loss Plan" />
        <AdminField label="Short line" value={tagline} onChangeText={setTagline} maxLength={60} placeholder="Calorie deficit, high protein" />
        <AdminField label="Description" value={description} onChangeText={setDescription} maxLength={200} multiline placeholder="Sustainable weight loss with balanced, high-protein meals" />
        <ChoiceChips label="Goal" options={GOALS.map((g) => ({ ...g }))} value={goal} onChange={setGoal} />
        <ChoiceChips label="Meals a day" options={MEALS.map((m) => ({ ...m }))} value={mealsPerDay} onChange={setMealsPerDay} />
        <View className="flex-row" style={{ gap: 10 }}>
          <View className="flex-1"><AdminField label="kcal a day" value={calories} onChangeText={(t) => setCalories(digits(t))} keyboardType="number-pad" maxLength={4} placeholder="2200" /></View>
          <View className="flex-1"><AdminField label="Water (L)" value={water} onChangeText={(t) => setWater(t.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" maxLength={4} placeholder="3" /></View>
        </View>
        <View className="flex-row" style={{ gap: 10 }}>
          <View className="flex-1"><AdminField label="Protein (g)" value={protein} onChangeText={(t) => setProtein(digits(t))} keyboardType="number-pad" maxLength={3} /></View>
          <View className="flex-1"><AdminField label="Carbs (g)" value={carbs} onChangeText={(t) => setCarbs(digits(t))} keyboardType="number-pad" maxLength={4} /></View>
          <View className="flex-1"><AdminField label="Fat (g)" value={fat} onChangeText={(t) => setFat(digits(t))} keyboardType="number-pad" maxLength={3} /></View>
        </View>
        <AdminField label="What's included (one a line)" value={included} onChangeText={setIncluded} multiline maxLength={500} />
        <Text className="type-headline text-forest-ink">Lengths and prices</Text>
        {lengths.map((l, i) => (
          <View key={i} className="flex-row" style={{ gap: 10 }}>
            <View className="flex-1"><AdminField label="Days" value={l.days} onChangeText={(t) => setLengths(lengths.map((x, j) => (j === i ? { ...x, days: digits(t) } : x)))} keyboardType="number-pad" maxLength={3} /></View>
            <View className="flex-1"><AdminField label="Price (₹)" value={l.price} onChangeText={(t) => setLengths(lengths.map((x, j) => (j === i ? { ...x, price: digits(t) } : x)))} keyboardType="number-pad" maxLength={7} placeholder="Empty: not offered" /></View>
          </View>
        ))}
        <Text className="type-headline text-forest-ink">{`Meals it rotates through (${mealIds.length})`}</Text>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {meals.map((m) => {
            const on = mealIds.includes(m.id);
            return (
              <Pressable key={m.id} onPress={() => setMealIds(on ? mealIds.filter((x) => x !== m.id) : [...mealIds, m.id])} className={on ? "setup__chip setup__chip--selected" : "setup__chip"} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                <Text className={on ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{m.name}</Text>
              </Pressable>
            );
          })}
        </View>
        <View className="card flex-row items-center" style={{ gap: 12 }}>
          <View className="flex-1">
            <Text className="card__title">Members see it</Text>
            <Text className="meta-text">{active ? "Shown on Meal Subscription." : "Hidden: nobody new can subscribe."}</Text>
          </View>
          <Switch value={active} onValueChange={setActive} {...switchColors} accessibilityLabel="Members see it" />
        </View>
        {error ? <FormAlert message={error} /> : null}
        <Pressable onPress={submit} disabled={!ready || busy} className={ready ? "btn-forest" : "btn-forest btn--disabled"} accessibilityRole="button">
          {busy && <ActivityIndicator size="small" color={colors.onPrimary} />}
          <Text className={ready ? "btn-forest__label" : "btn-forest__label btn--disabled-label"}>{plan ? "Save changes" : "Save plan"}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoider>
  );
}
