import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useLocalSearchParams } from "expo-router";

import { MacroHeader } from "@/components/macro/MacroHeader";
import { Segmented } from "@/components/macro/Segmented";
import { kcalOf, loggedAtFor, macro, macrosAgree, slotForNow, slotInfo, slots, todayIso, whole, type Slot } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { useMacroStore } from "@/store/macro";
import { useThemeColors, Palette } from "@/theme";
import { fonts } from "@/constants/fonts";
import { track } from "@/lib/analytics";
import { haptic } from "@/lib/haptics";
import { findFood, nutrientsFor, rescale, searchFoods, unitsFor, type Nutrients } from "@/lib/foods";
import type { Food, FoodUnit } from "@/data/foods";

const UNIT_LABEL: Record<FoodUnit, string> = { g: "g", ml: "ml", piece: "pieces" };
const macroFields = (colors: Palette) => ([
  { key: "protein", label: "Protein", color: colors.protein },
  { key: "carbs", label: "Carbs", color: colors.carbs },
  { key: "fat", label: "Fat", color: colors.fat },
] as const);

// Digits and one decimal point only, at most 6 characters
const numeric = (text: string) => text.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 6);
const toNumber = (text: string) => (text.trim() === "" ? 0 : Number(text));

// Where a food's numbers came from: the built-in list (recalculated when the amount changes), an AI
// estimate for an amount in a unit (rescaled in that unit), or typed by hand (null: left alone)
type Basis = { source: "list" } | { source: "ai"; nutrients: Nutrients; amount: number; unit: FoodUnit } | null;
// One food being typed in
type FoodDraft = {
  key: number; name: string; foodId: string | null; quantity: string; unit: FoodUnit; kcal: string; grams: { protein: string; carbs: string; fat: string };
  basis: Basis; estimating: boolean; estimateError: string | null;
};
// At most this many foods in one meal typed by hand (the server allows more)
const MAX_FOODS = 15;
let nextKey = 1;
const emptyFood = (): FoodDraft => ({ key: nextKey++, name: "", foodId: null, quantity: "", unit: "g", kcal: "", grams: { protein: "", carbs: "", fat: "" }, basis: null, estimating: false, estimateError: null });

// Numbers → the text in the fields
const filled = (n: Nutrients): Pick<FoodDraft, "kcal" | "grams"> => ({ kcal: String(n.kcal), grams: { protein: String(n.proteinG), carbs: String(n.carbsG), fat: String(n.fatG) } });

// The food after its amount or unit changed: numbers from the list or an AI estimate follow it
function withAmount(food: FoodDraft, quantity: string, unit: FoodUnit): FoodDraft {
  const next = { ...food, quantity, unit };
  const amount = toNumber(quantity);
  const listed = findFood(food.foodId);
  if (food.basis?.source === "list" && listed) {
    const n = nutrientsFor(listed, amount, unit);
    return n ? { ...next, ...filled(n) } : next;
  }
  if (food.basis?.source === "ai") {
    if (unit !== food.basis.unit) return { ...next, basis: null };
    const n = rescale(food.basis.nutrients, food.basis.amount, amount);
    return n ? { ...next, ...filled(n) } : next;
  }
  return next;
}

// Logging by hand: one or more foods (each with its name, amount, calories and macros), saved as
// one meal. With two or more foods the meal can have its own name (else the foods' names). On
// success the whole logging flow closes back to the Macro tab.
export default function ManualEntry() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ slot?: string; hour?: string; minute?: string }>();
  const getToken = useSessionToken();
  const selectedDate = useMacroStore((state) => state.selectedDate);
  const [foods, setFoods] = useState<FoodDraft[]>(() => [emptyFood()]);
  const [mealName, setMealName] = useState("");
  const [slot, setSlot] = useState<Slot>(slots.includes(params.slot as Slot) ? (params.slot as Slot) : slotForNow());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const update = (key: number, change: Partial<FoodDraft> | ((food: FoodDraft) => FoodDraft)) =>
    setFoods((list) => list.map((f) => (f.key === key ? (typeof change === "function" ? change(f) : { ...f, ...change }) : f)));

  // Asks the AI for one food's numbers for its amount; the answer fills the fields
  const estimate = async (food: FoodDraft) => {
    const amount = toNumber(food.quantity);
    if (food.estimating || food.name.trim().length < 2 || !(amount > 0)) return;
    update(food.key, { estimating: true, estimateError: null });
    const result = await macro.estimateFood(await getToken().catch(() => null), { name: food.name.trim(), quantity: amount, unit: food.unit });
    if (!result.ok) return update(food.key, { estimating: false, estimateError: result.status ? result.error : "Could not reach justFit. Check your connection and try again." });
    const n = result.data.estimate;
    update(food.key, (f) => ({ ...f, ...filled(n), estimating: false, estimateError: null, basis: { source: "ai", nutrients: n, amount, unit: food.unit } }));
  };
  const addFood = () => {
    if (foods.length >= MAX_FOODS) return;
    haptic.select?.();
    setFoods((list) => [...list, emptyFood()]);
  };
  const removeFood = (key: number) => setFoods((list) => (list.length > 1 ? list.filter((f) => f.key !== key) : list));

  const total = foods.reduce(
    (t, f) => ({ kcal: t.kcal + toNumber(f.kcal), proteinG: t.proteinG + toNumber(f.grams.protein), carbsG: t.carbsG + toNumber(f.grams.carbs), fatG: t.fatG + toNumber(f.grams.fat) }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
  const several = foods.length > 1;

  const save = async () => {
    if (saving) return;
    setError(null);
    if (selectedDate !== todayIso()) return setError("Meals can only be logged for today.");
    for (const [i, f] of foods.entries()) {
      const which = several ? `food ${i + 1}` : "the food";
      if (!f.name.trim()) return setError(several ? `Give ${which} a name.` : "Give the food a name.");
      if (!(toNumber(f.kcal) > 0)) return setError(several ? `Enter the calories for ${f.name.trim()}.` : "Enter the calories.");
    }
    const title = (several && mealName.trim()) || foods.map((f) => f.name.trim()).join(", ").slice(0, 120);
    setSaving(true);
    const result = await macro.logMeal(await getToken().catch(() => null), {
      date: selectedDate,
      slot,
      title,
      loggedAt: loggedAtFor(selectedDate, params.hour, params.minute), // the time chosen on Add meal, or now
      source: "manual",
      items: foods.map((f) => {
        const amount = toNumber(f.quantity);
        return {
          name: f.name.trim(),
          quantity: amount > 0 ? amount : 1,
          unit: amount > 0 ? f.unit : "serving",
          kcal: toNumber(f.kcal),
          proteinG: toNumber(f.grams.protein),
          carbsG: toNumber(f.grams.carbs),
          fatG: toNumber(f.grams.fat),
        };
      }),
    });
    setSaving(false);
    if (!result.ok) return setError(result.status ? result.error : "Could not save that meal.");
    track("meal_logged", { source: "manual" });
    haptic.success();
    router.dismissTo("/macro"); // the Macro tab reloads the day when it comes back into view
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <MacroHeader title="Manual entry" />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 16 }} keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"} showsVerticalScrollIndicator={false}>
            <Text className="home__lead">{"Search a food and enter how much: we fill in the calories and macros. A dish with several foods? Add each one."}</Text>

            {several && (
              <View className="gap-2">
                <Text className="setup__section">Meal name (optional)</Text>
                <View className="setup__field">
                  <SymbolView name={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }} size={18} tintColor={colors.muted} />
                  <TextInput className="setup__field-input min-w-0 flex-1" value={mealName} onChangeText={setMealName} placeholder="Lunch thali" placeholderTextColor={colors.faint} maxLength={120} accessibilityLabel="Meal name" />
                </View>
              </View>
            )}

            {foods.map((food, i) => (
              <FoodFields
                key={food.key}
                food={food}
                index={i}
                several={several}
                onChange={(change) => update(food.key, change)}
                onEstimate={() => estimate(food)}
                onRemove={several ? () => removeFood(food.key) : undefined}
              />
            ))}

            {foods.length < MAX_FOODS && (
              <Pressable onPress={addFood} className="btn-outline" accessibilityRole="button" accessibilityLabel="Add another food">
                <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={16} tintColor={colors.leaf} />
                <Text className="btn-outline__label">Add another food</Text>
              </Pressable>
            )}

            {several && (
              <View className="home__card gap-1" accessibilityLabel={`Meal total: ${whole(total.kcal)} kcal, protein ${whole(total.proteinG)} g, carbs ${whole(total.carbsG)} g, fat ${whole(total.fatG)} g`}>
                <Text className="setup__section">{`Meal total · ${foods.length} foods`}</Text>
                <Text className="macro__stat-value">{`${whole(total.kcal)} kcal`}</Text>
                <Text className="home__note">{`Protein ${whole(total.proteinG)} g · Carbs ${whole(total.carbsG)} g · Fat ${whole(total.fatG)} g`}</Text>
              </View>
            )}

            <View className="gap-2">
              <Text className="setup__section">Add to</Text>
              <Segmented options={slots.map((s) => ({ value: s, label: slotInfo[s].label }))} value={slot} onChange={setSlot} label="Meal slot" />
            </View>

            {error && <Text className="macro__error" accessibilityRole="alert">{error}</Text>}
          </ScrollView>

          <View className="px-5 pb-3 pt-2">
            <Pressable onPress={save} disabled={saving} className="btn-forest" style={{ opacity: saving ? 0.7 : 1 }} accessibilityRole="button" accessibilityLabel="Save meal">
              {saving ? <ActivityIndicator color={colors.white} /> : <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={16} tintColor={colors.white} />}
              <Text className="btn-forest__label">{several ? `Save meal · ${foods.length} foods` : "Save meal"}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

// One food's fields: name (with matches from the built-in list as you type), amount and unit,
// calories and the three macros, where they came from, and a check that the macros add up to
// about the calories. The first food keeps the plain labels ("Food name"); the others are
// numbered ("Food 2 name") so every field has its own name for screen readers.
function FoodFields({ food, index, several, onChange, onEstimate, onRemove }: { food: FoodDraft; index: number; several: boolean; onChange: (change: Partial<FoodDraft> | ((food: FoodDraft) => FoodDraft)) => void; onEstimate: () => void; onRemove?: () => void }) {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);
  const tag = index === 0 ? "" : `Food ${index + 1} `;
  const listed = findFood(food.foodId);
  const matches = focused && !listed ? searchFoods(food.name) : [];
  const typedKcal = toNumber(food.kcal);
  const amount = toNumber(food.quantity);
  const macroKcal = Math.round(kcalOf({ proteinG: toNumber(food.grams.protein), carbsG: toNumber(food.grams.carbs), fatG: toNumber(food.grams.fat) }));
  const showSanity = food.basis === null && typedKcal > 0 && (food.grams.protein !== "" || food.grams.carbs !== "" || food.grams.fat !== "");
  const canEstimate = !listed && food.basis?.source !== "ai" && food.name.trim().length >= 2 && amount > 0;

  const pick = (picked: Food) => {
    const unit = picked.pieceG ? "piece" : picked.liquid ? "ml" : "g";
    const quantity = unit === "piece" ? "1" : "100";
    const n = nutrientsFor(picked, Number(quantity), unit);
    setFocused(false);
    haptic.select();
    onChange((f) => ({ ...f, name: picked.name, foodId: picked.id, unit, quantity, basis: { source: "list" }, estimateError: null, ...(n ? filled(n) : {}) }));
  };
  // Typing a number by hand: it's theirs now, nothing recalculates it
  const typed = (change: Partial<FoodDraft>) => onChange({ ...change, basis: null });

  const per = listed ? (listed.pieceG ? `${Math.round((listed.per100.kcal * listed.pieceG) / 100)} kcal a piece` : `${listed.per100.kcal} kcal per 100 ${listed.liquid ? "ml" : "g"}`) : "";
  const fields = (
    <>
      <View className="gap-2">
        <Text className="setup__section">Food name</Text>
        <View className="setup__field">
          <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
          <TextInput
            className="setup__field-input min-w-0 flex-1"
            value={food.name}
            onChangeText={(name) => onChange({ name, foodId: null, basis: food.basis?.source === "list" ? null : food.basis })}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder={index === 0 ? "Search: idli, dal, paneer…" : "Jeera rice"}
            placeholderTextColor={colors.faint}
            maxLength={120}
            accessibilityLabel={index === 0 ? "Food name" : `${tag}name`}
          />
          {listed && <SymbolView name={{ ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" }} size={18} tintColor={colors.success} />}
        </View>
        {matches.length > 0 && (
          <View className="home__card" style={{ paddingVertical: 4, paddingHorizontal: 0 }}>
            {matches.map((m) => (
              <Pressable key={m.id} onPress={() => pick(m)} className="flex-row items-center justify-between px-4 py-2.5" accessibilityRole="button" accessibilityLabel={`Pick ${m.name}`}>
                <Text className="macro__table-cell flex-1" numberOfLines={1}>{m.name}</Text>
                <Text className="home__note">{m.pieceG ? `${Math.round((m.per100.kcal * m.pieceG) / 100)} kcal / piece` : `${m.per100.kcal} kcal / 100 ${m.liquid ? "ml" : "g"}`}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <View className="gap-2">
        <Text className="setup__section">Amount</Text>
        <View className="flex-row items-center gap-3">
          <View className="setup__field min-w-0 flex-1">
            <TextInput className="setup__field-input min-w-0 flex-1" value={food.quantity} onChangeText={(t) => onChange((f) => withAmount(f, numeric(t), f.unit))} placeholder={food.unit === "piece" ? "2" : "150"} placeholderTextColor={colors.faint} keyboardType="decimal-pad" accessibilityLabel={`${tag}Quantity`.trim()} />
          </View>
          <View style={{ width: 170 }}>
            <Segmented options={unitsFor(listed).map((u) => ({ value: u, label: UNIT_LABEL[u] }))} value={food.unit} onChange={(unit) => onChange((f) => withAmount(f, f.quantity, unit))} label={`${tag}Serving unit`.trim()} />
          </View>
        </View>
      </View>

      {canEstimate && (
        <Pressable onPress={onEstimate} disabled={food.estimating} className="btn-outline" accessibilityRole="button" accessibilityLabel={`Estimate ${food.name.trim()} with AI`}>
          {food.estimating ? <ActivityIndicator color={colors.leaf} /> : <SymbolView name={{ ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }} size={16} tintColor={colors.leaf} />}
          <Text className="btn-outline__label">{food.estimating ? "Estimating…" : "Not in the list? Estimate with AI"}</Text>
        </Pressable>
      )}
      {food.estimateError && <Text className="macro__error" accessibilityRole="alert">{food.estimateError}</Text>}

      <View className="gap-2">
        <Text className="setup__section">Calories</Text>
        <View className="setup__field">
          <SymbolView name={{ ios: "flame.fill", android: "local_fire_department", web: "local_fire_department" }} size={18} tintColor={colors.danger} />
          <TextInput className="setup__field-input min-w-0 flex-1" value={food.kcal} onChangeText={(t) => typed({ kcal: numeric(t) })} placeholder="480" placeholderTextColor={colors.faint} keyboardType="decimal-pad" accessibilityLabel={`${tag}Calories in kcal`.trim()} />
          <Text className="setup__unit">kcal</Text>
        </View>
      </View>

      <View className="gap-2">
        <Text className="setup__section">Macros</Text>
        <View className="flex-row gap-2">
          {macroFields(colors).map((m) => (
            <View key={m.key} className="macro__macro-box">
              <View className="flex-row items-center gap-1.5">
                <View className="h-2 w-2 rounded-pill" style={{ backgroundColor: m.color }} />
                <Text className="macro__bar-label">{m.label}</Text>
              </View>
              <View className="mt-1 min-w-0 flex-row items-baseline gap-1">
                <TextInput
                  className="setup__field-input min-w-0 flex-1"
                  value={food.grams[m.key]}
                  onChangeText={(t) => typed({ grams: { ...food.grams, [m.key]: numeric(t) } })}
                  placeholder="0"
                  placeholderTextColor={colors.faint}
                  keyboardType="decimal-pad"
                  accessibilityLabel={`${tag}${m.label} in grams`}
                />
                <Text className="setup__unit">g</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {food.basis && (
        <View className="flex-row items-center gap-2">
          <SymbolView name={food.basis.source === "list" ? { ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" } : { ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }} size={16} tintColor={food.basis.source === "list" ? colors.success : colors.leaf} />
          <Text className="home__note flex-1" style={{ color: colors.muted }}>
            {food.basis.source === "list"
              ? `Calculated from our food list (${per}${food.unit === "piece" && listed?.pieceG ? `, a piece is about ${listed.pieceG} g` : ""}). Change the numbers if your recipe differs.`
              : "Estimated by AI for this amount. Check it and change anything that looks off."}
          </Text>
        </View>
      )}

      {showSanity && (
        <View className="flex-row items-center gap-2">
          <SymbolView
            name={macrosAgree(typedKcal, macroKcal) ? { ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" } : { ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }}
            size={16}
            tintColor={macrosAgree(typedKcal, macroKcal) ? colors.success : colors.warning}
          />
          <Text className="home__note flex-1" style={{ color: colors.muted }}>
            Macros add up to <Text style={{ fontFamily: fonts.semibold, color: colors.forestInk }}>{macroKcal} kcal</Text>
            {macrosAgree(typedKcal, macroKcal) ? ` — close to your ${whole(typedKcal)} entry. Looks good.` : ` — far from your ${whole(typedKcal)} entry. Worth a second look.`}
          </Text>
        </View>
      )}
    </>
  );
  if (!several) return <View className="gap-4">{fields}</View>;
  return (
    <View className="home__card gap-4">
      <View className="flex-row items-center justify-between">
        <Text className="card__title">{`Food ${index + 1}${food.name.trim() ? ` · ${food.name.trim()}` : ""}`}</Text>
        {onRemove && (
          <Pressable onPress={onRemove} hitSlop={8} className="flex-row items-center gap-1" accessibilityRole="button" accessibilityLabel={`Remove food ${index + 1}`}>
            <SymbolView name={{ ios: "trash", android: "delete", web: "delete" }} size={14} tintColor={colors.danger} />
            <Text className="home__note" style={{ color: colors.danger }}>Remove</Text>
          </Pressable>
        )}
      </View>
      {fields}
    </View>
  );
}
