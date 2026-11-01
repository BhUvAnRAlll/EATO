import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { SymbolView } from "@/components/SymbolView";
import { track } from "@/lib/analytics";
import { coachApi, type MealOption, type MealPreference, type PlanItem, type PlanMeal, type PlanSlot, type Totals } from "@/lib/coach";
import { todayIso } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";
import { haptic } from "@/lib/haptics";

const OFFLINE = "Could not reach justFit. Check your connection and try again.";
const SLOT_LABEL: Record<PlanSlot, string> = { breakfast: "Breakfast", morning_snack: "Morning snack", lunch: "Lunch", evening_snack: "Evening snack", dinner: "Dinner" };

const back = () => (router.canGoBack() ? router.back() : router.replace("/coach/meal-plan"));
const kcal = (n: number) => Math.round(n).toLocaleString("en-IN");
const grams = (n: number) => `${Math.round(n)} g`;

// The chips that steer the next ask
const PREFERENCES: { id: MealPreference; label: string }[] = [
  { id: "lighter", label: "Lighter" },
  { id: "more_protein", label: "More protein" },
  { id: "different_cuisine", label: "Different cuisine" },
  { id: "quick", label: "Quick to make" },
];

// Portions move in steps you can measure: 25 g or ml, else halves (a piece, cup, bowl, spoon)
const stepFor = (unit: string) => (unit === "g" || unit === "ml" ? 25 : 0.5);
const round2 = (n: number) => Math.round(n * 100) / 100;
// "1.5 bowl" or "150 g": a portion as people read it
const portion = (quantity: number, unit: string) => `${round2(quantity)} ${unit}`;

// A food's numbers at a new portion, the way the server will work them out
const scaled = (item: PlanItem, quantity: number): Totals => {
  const f = item.quantity > 0 ? quantity / item.quantity : 0;
  return { kcal: item.kcal * f, proteinG: item.proteinG * f, carbsG: item.carbsG * f, fatG: item.fatG * f };
};
const sumOf = (items: PlanItem[], quantities: number[]): Totals =>
  items.reduce((t, item, i) => {
    const s = scaled(item, quantities[i] ?? item.quantity);
    return { kcal: t.kcal + s.kcal, proteinG: t.proteinG + s.proteinG, carbsG: t.carbsG + s.carbsG, fatG: t.fatG + s.fatG };
  }, { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });

// The P / C / F chips a meal and every option carry
function MacroChips({ totals }: { totals: Totals }) {
  const macros: [string, number][] = [["P", totals.proteinG], ["C", totals.carbsG], ["F", totals.fatG]];
  return (
    <View className="flex-row flex-wrap" style={{ gap: 8 }} accessibilityLabel={`Protein ${grams(totals.proteinG)}, carbs ${grams(totals.carbsG)}, fat ${grams(totals.fatG)}`}>
      {macros.map(([k, v]) => (
        <View key={k} className="coach__macro-chip">
          <Text className="coach__macro-chip-label">{`${k} ${grams(v)}`}</Text>
        </View>
      ))}
    </View>
  );
}

// Three grey cards that breathe while the coach thinks
function Skeleton() {
  const [pulse] = useState(() => new Animated.Value(0.45));
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.45, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View style={{ gap: 12 }} accessibilityLabel="Finding options for you" accessibilityRole="progressbar">
      {[0, 1, 2].map((i) => (
        <Animated.View key={i} className="swap__card" style={{ opacity: pulse }}>
          <View className="swap__skeleton" style={{ height: 20, width: "55%" }} />
          <View className="swap__skeleton" style={{ height: 14, width: "90%" }} />
          <View className="flex-row" style={{ gap: 8 }}>
            {[0, 1, 2].map((j) => <View key={j} className="swap__skeleton" style={{ height: 30, width: 58 }} />)}
          </View>
          <View className="swap__skeleton" style={{ height: 48, borderRadius: 999 }} />
        </Animated.View>
      ))}
    </View>
  );
}

// One option: the dish, why it fits, calories and macros, the foods with portions, the coach's
// tip, and the Replace meal button (or "In your plan" once chosen). Edit portions turns the foods
// into steppers (and a way to leave one out); the numbers follow the portions, and Replace sends
// them to the server, which works the meal out from them again.
function OptionCard({ option, chosen, busy, replacing, onReplace }: { option: MealOption; chosen: boolean; busy: boolean; replacing: boolean; onReplace: (quantities: number[] | null) => void }) {
  const colors = useThemeColors();
  const original = option.items.map((i) => i.quantity);
  const [editingNow, setEditing] = useState(false);
  // A card that went into the plan shows its foods as they went in, without the steppers
  const editing = editingNow && !chosen;
  const [quantities, setQuantities] = useState<number[]>(original);
  const edited = quantities.some((q, i) => q !== original[i]);
  const totals = edited ? sumOf(option.items, quantities) : option.totals;
  const kept = quantities.filter((q) => q > 0).length;
  const setQuantity = (i: number, value: number) => setQuantities((q) => q.map((v, j) => (j === i ? round2(value) : v)));
  return (
    <View className={chosen ? "swap__card swap__card--chosen" : "swap__card"} accessibilityLabel={`${option.name}: ${kcal(totals.kcal)} kcal`}>
      <View className="flex-row items-start justify-between" style={{ gap: 12 }}>
        <Text className="swap__name min-w-0 flex-1">{option.name}</Text>
        <Text className="swap__kcal">{`${kcal(totals.kcal)} kcal`}</Text>
      </View>
      {option.description && <Text className="swap__desc">{option.description}</Text>}
      <MacroChips totals={totals} />
      <View style={{ gap: editing ? 8 : 2 }}>
        {option.items.map((item, i) => {
          const quantity = quantities[i];
          const out = quantity <= 0;
          const step = stepFor(item.unit);
          if (!editing) return <Text key={`${option.id}-${i}`} className="swap__ing" style={out ? { textDecorationLine: "line-through", color: colors.faint } : undefined}>{`• ${item.name} · ${portion(quantity > 0 ? quantity : item.quantity, item.unit)} · ${Math.round(scaled(item, quantity > 0 ? quantity : item.quantity).kcal)} kcal`}</Text>;
          return (
            <View key={`${option.id}-${i}`} className="flex-row items-center" style={{ gap: 8 }}>
              <Text className="swap__ing min-w-0 flex-1" numberOfLines={2} style={out ? { textDecorationLine: "line-through", color: colors.faint } : undefined}>{`${item.name} · ${Math.round(scaled(item, out ? 0 : quantity).kcal)} kcal`}</Text>
              {out ? (
                <Pressable onPress={() => setQuantity(i, item.quantity)} disabled={busy} className="swap__step swap__step--wide" accessibilityRole="button" accessibilityLabel={`Put back ${item.name}`}>
                  <Text className="swap__step-label">Put back</Text>
                </Pressable>
              ) : (
                <>
                  <Pressable onPress={() => setQuantity(i, Math.max(step, quantity - step))} disabled={busy || quantity <= step} className="swap__step" style={{ opacity: quantity <= step ? 0.4 : 1 }} accessibilityRole="button" accessibilityLabel={`Less ${item.name}`}>
                    <SymbolView name={{ ios: "minus", android: "remove", web: "remove" }} size={14} tintColor={colors.ink} />
                  </Pressable>
                  <Text className="swap__portion" numberOfLines={1}>{portion(quantity, item.unit)}</Text>
                  <Pressable onPress={() => setQuantity(i, quantity + step)} disabled={busy} className="swap__step" accessibilityRole="button" accessibilityLabel={`More ${item.name}`}>
                    <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={14} tintColor={colors.ink} />
                  </Pressable>
                  <Pressable onPress={() => setQuantity(i, 0)} disabled={busy || kept <= 1} className="swap__step" style={{ opacity: kept <= 1 ? 0.4 : 1 }} accessibilityRole="button" accessibilityLabel={`Leave out ${item.name}`}>
                    <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={13} tintColor={colors.danger} />
                  </Pressable>
                </>
              )}
            </View>
          );
        })}
        {option.note && !editing && <Text className="coach__food">{`Tip: ${option.note}`}</Text>}
      </View>
      {!chosen && (
        <View className="flex-row items-center" style={{ gap: 12 }}>
          <Pressable onPress={() => setEditing((v) => !v)} disabled={busy} hitSlop={8} className="flex-row items-center" style={{ gap: 4 }} accessibilityRole="button" accessibilityLabel={editing ? `Done editing ${option.name}` : `Edit portions of ${option.name}`} accessibilityState={{ expanded: editing }}>
            <SymbolView name={editing ? { ios: "checkmark", android: "check", web: "check" } : { ios: "slider.horizontal.3", android: "tune", web: "tune" }} size={14} tintColor={colors.primaryText} />
            <Text className="coach__ghost-label" style={{ fontSize: 13 }}>{editing ? "Done editing" : "Edit portions"}</Text>
          </Pressable>
          {edited && (
            <Pressable onPress={() => setQuantities(original)} disabled={busy} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Reset the portions of ${option.name}`}>
              <Text className="coach__hint">Reset</Text>
            </Pressable>
          )}
        </View>
      )}
      <Pressable
        onPress={() => onReplace(edited ? quantities : null)}
        disabled={busy || chosen}
        className={chosen ? "swap__replace swap__replace--done" : "swap__replace"}
        style={{ opacity: busy && !replacing ? 0.5 : 1 }}
        accessibilityRole="button"
        accessibilityLabel={chosen ? `${option.name} is in your plan` : `Replace meal with ${option.name}`}
        accessibilityState={{ disabled: busy || chosen, busy: replacing }}
      >
        {replacing ? (
          <ActivityIndicator size="small" color={colors.white} />
        ) : chosen ? (
          <>
            <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={14} tintColor={colors.success} />
            <Text className="swap__replace-label swap__replace-label--done">In your plan</Text>
          </>
        ) : (
          <>
            <SymbolView name={{ ios: "arrow.triangle.2.circlepath", android: "swap_horiz", web: "swap_horiz" }} size={16} tintColor={colors.white} />
            <Text className="swap__replace-label">{edited ? "Replace with my portions" : "Replace meal"}</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

// Swap Meal: the meal being replaced, what's left of the day, and five dishes the coach offers
// in its place, made for the member (goal, diet, allergies, dislikes, targets) and the day. Replace
// meal puts one in the plan at once (the plan's totals follow) with Undo to put the old meal back;
// the chips steer the next ask (lighter, more protein, a different cuisine, quick) and More
// options asks again, leaving out what was already offered. Edit portions on a card changes the
// amounts before it goes in.
export default function SwapMealScreen() {
  const colors = useThemeColors();
  const { mealId } = useLocalSearchParams<{ mealId: string }>();
  const getToken = useSessionToken();
  const [meal, setMeal] = useState<PlanMeal | null>(null);
  const [options, setOptions] = useState<MealOption[] | null>(null);
  const [remaining, setRemaining] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [preference, setPreference] = useState<MealPreference | null>(null);
  // After a replacement: which option is in the plan, how to undo it, and the line to show
  const [done, setDone] = useState<{ optionId: string | null; undoId: string; title: string; text: string } | null>(null);
  const [pop] = useState(() => new Animated.Value(0));
  const latest = useRef(0);

  // The meal as the plan has it now, and three options for it (both with today's date)
  const load = useCallback(async () => {
    if (!mealId) return setError("That meal isn't in your plan.");
    const request = ++latest.current;
    setLoading(true);
    setError(null);
    setActionError(null);
    const token = await getToken().catch(() => null);
    const [planResult, optionsResult] = await Promise.all([coachApi.plan(token, todayIso()), coachApi.mealOptions(token, mealId, todayIso())]);
    if (request !== latest.current) return;
    setLoading(false);
    const found = planResult.ok ? planResult.data.plan?.meals.find((m) => m.id === mealId) ?? null : null;
    if (!planResult.ok) return setError(planResult.status ? planResult.error : OFFLINE);
    if (!found) return setError("That meal isn't in your plan any more.");
    setMeal(found);
    if (!optionsResult.ok) return setError(optionsResult.status ? optionsResult.error : OFFLINE);
    setOptions(optionsResult.data.options);
    setRemaining(optionsResult.data.remaining);
  }, [getToken, mealId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Another ask, steered by `next` (a chip) or the chip already picked; the server leaves out what it already offered
  const ask = async (next: MealPreference | null) => {
    if (loading || replacing || !mealId) return;
    const request = ++latest.current;
    setPreference(next);
    setLoading(true);
    setActionError(null);
    const result = await coachApi.mealOptions(await getToken().catch(() => null), mealId, todayIso(), next);
    if (request !== latest.current) return;
    setLoading(false);
    if (!result.ok) return setActionError(result.status ? result.error : OFFLINE);
    setOptions(result.data.options);
    setRemaining(result.data.remaining);
  };
  const more = () => ask(preference);

  const celebrate = () => {
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }).start();
  };

  // Replace meal: the option goes into the plan; the old meal can come back with Undo
  const replace = async (option: MealOption, quantities: number[] | null) => {
    if (replacing || loading || !mealId) return;
    setActionError(null);
    setReplacing(option.id);
    const result = await coachApi.replaceMeal(await getToken().catch(() => null), mealId, todayIso(), option.id, quantities);
    setReplacing(null);
    if (!result.ok) return setActionError(result.status ? result.error : OFFLINE);
    track("coach_meal_swapped");
    haptic.success();
    const updated = result.data.plan?.meals.find((m) => m.id === mealId);
    if (updated) setMeal(updated);
    setDone({ optionId: option.id, undoId: result.data.undoId, title: `Replaced with ${result.data.name}`, text: `Your plan now totals ${kcal(result.data.plan?.totals.kcal ?? 0)} kcal. ${result.data.replaced.name} is one tap away if you change your mind.` });
    celebrate();
  };

  // Undo: the snapshot the replacement left goes back in (the same call, no AI)
  const undo = async () => {
    if (!done || replacing || !mealId) return;
    setActionError(null);
    setReplacing(done.undoId);
    const result = await coachApi.replaceMeal(await getToken().catch(() => null), mealId, todayIso(), done.undoId);
    setReplacing(null);
    if (!result.ok) return setActionError(result.status ? result.error : OFFLINE);
    const updated = result.data.plan?.meals.find((m) => m.id === mealId);
    if (updated) setMeal(updated);
    setDone({ optionId: null, undoId: result.data.undoId, title: `Restored ${result.data.name}`, text: "Your plan is back as it was. Pick another option, or go back." });
    celebrate();
  };

  const busy = replacing !== null || loading;
  const slot = meal ? SLOT_LABEL[meal.slot] : null;

  return (
    <View className="coach__page">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View className="h-14 flex-row items-center px-4" style={{ gap: 12 }}>
          <Pressable onPress={back} className="coach__circle-btn" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "arrow.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
          </Pressable>
          <View className="min-w-0 flex-1">
            <Text className="coach__title" style={{ fontSize: 24, lineHeight: 30 }} accessibilityRole="header" numberOfLines={1}>Swap meal</Text>
          </View>
          {slot && <Text className="coach__hint" numberOfLines={1}>{slot}</Text>}
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40, gap: 16 }} showsVerticalScrollIndicator={false}>
          {meal && (
            <View className="coach__meal-card" accessibilityLabel={`Replacing ${meal.name}, ${kcal(meal.totals.kcal)} kcal`}>
              <View className="flex-row flex-wrap items-center justify-between" style={{ gap: 8 }}>
                <View className="coach__slot-pill">
                  <Text className="coach__slot-pill-label">{done?.optionId ? "Now in your plan" : "Replacing"}</Text>
                </View>
                <Text className="coach__meal-kcal">{`${kcal(meal.totals.kcal)} kcal`}</Text>
              </View>
              <Text className="coach__meal-name">{meal.name}</Text>
              <Text className="coach__meal-ings" numberOfLines={2}>{meal.items.map((i) => i.name).join(", ")}</Text>
              <MacroChips totals={meal.totals} />
            </View>
          )}

          {remaining && (
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              <View className={remaining.kcal > 0 ? "home__pill-soft" : "home__pill-soft home__pill-soft--grey"}>
                <SymbolView name={{ ios: "flame.fill", android: "local_fire_department", web: "local_fire_department" }} size={13} tintColor={remaining.kcal > 0 ? colors.primaryText : colors.muted} />
                <Text className={remaining.kcal > 0 ? "home__pill-soft-label" : "home__pill-soft-label home__pill-soft-label--grey"}>{remaining.kcal > 0 ? `${kcal(remaining.kcal)} kcal left today` : `${kcal(-remaining.kcal)} kcal over today`}</Text>
              </View>
              {remaining.proteinG > 0 && (
                <View className="home__pill-soft home__pill-soft--grey">
                  <Text className="home__pill-soft-label home__pill-soft-label--grey">{`${grams(remaining.proteinG)} protein to go`}</Text>
                </View>
              )}
            </View>
          )}

          {done && (
            <Animated.View className="swap__success" style={{ opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }} accessibilityRole="alert" accessibilityLiveRegion="polite">
              <View className="flex-row items-center" style={{ gap: 12 }}>
                <View className="swap__success-icon">
                  <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={22} tintColor={colors.white} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="swap__success-title">{done.title}</Text>
                  <Text className="swap__success-text">{done.text}</Text>
                </View>
              </View>
              <View className="flex-row justify-end" style={{ gap: 8 }}>
                {done.optionId && (
                  <Pressable onPress={undo} disabled={busy} className="swap__undo" style={{ opacity: busy ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Undo and restore the previous meal">
                    {replacing === done.undoId ? <ActivityIndicator size="small" color={colors.ink} /> : <SymbolView name={{ ios: "arrow.uturn.backward", android: "undo", web: "undo" }} size={15} tintColor={colors.ink} />}
                    <Text className="swap__undo-label">Undo</Text>
                  </Pressable>
                )}
                <Pressable onPress={back} disabled={replacing !== null} className="swap__done" accessibilityRole="button" accessibilityLabel="Done, back to the meal plan">
                  <Text className="swap__done-label">Done</Text>
                </Pressable>
              </View>
            </Animated.View>
          )}

          {error ? (
            <View className="coach__card items-center">
              <Text className="coach__option-title text-center">{"Couldn't find options"}</Text>
              <Text className="coach__lead text-center">{error}</Text>
              <Pressable onPress={load} className="coach__ghost self-stretch" accessibilityRole="button" accessibilityLabel="Try again">
                <Text className="coach__ghost-label">Try again</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {/* The chips: tap one to ask again with that in mind; tap it again to drop it */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginHorizontal: -16, paddingHorizontal: 16 }}>
                {PREFERENCES.map((pref) => {
                  const on = preference === pref.id;
                  return (
                    <Pressable key={pref.id} onPress={() => { haptic.select(); ask(on ? null : pref.id); }} disabled={busy} className={on ? "swap__chip swap__chip--on" : "swap__chip"} style={{ opacity: busy ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel={on ? `${pref.label}, selected. Tap to ask without it` : `Ask for ${pref.label.toLowerCase()} options`} accessibilityState={{ selected: on }}>
                      <Text className={on ? "swap__chip-label swap__chip-label--on" : "swap__chip-label"}>{pref.label}</Text>
                    </Pressable>
                  );
                })}
                <View style={{ width: 8 }} />
              </ScrollView>

              <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
                <Text className="coach__section">{loading ? "Finding options for you…" : "Options for you"}</Text>
                {!loading && options && (
                  <Pressable onPress={more} disabled={busy} hitSlop={8} className="flex-row items-center" style={{ gap: 4, opacity: busy ? 0.5 : 1 }} accessibilityRole="button" accessibilityLabel="More options">
                    <SymbolView name={{ ios: "arrow.clockwise", android: "refresh", web: "refresh" }} size={15} tintColor={colors.primaryText} />
                    <Text className="coach__ghost-label">More options</Text>
                  </Pressable>
                )}
              </View>
              {loading ? (
                <Skeleton />
              ) : options && options.length > 0 ? (
                <View style={{ gap: 12 }}>
                  {options.map((option) => (
                    <OptionCard key={option.id} option={option} chosen={done?.optionId === option.id} busy={busy} replacing={replacing === option.id} onReplace={(quantities) => replace(option, quantities)} />
                  ))}
                </View>
              ) : (
                <View className="coach__card items-center">
                  <Text className="coach__option-title text-center">No options this time</Text>
                  <Text className="coach__lead text-center">Your coach had nothing new for this meal. Try again in a moment.</Text>
                  <Pressable onPress={more} className="coach__ghost self-stretch" accessibilityRole="button" accessibilityLabel="Try again">
                    <Text className="coach__ghost-label">Try again</Text>
                  </Pressable>
                </View>
              )}
            </>
          )}

          {actionError && <Text className="macro__error" accessibilityRole="alert">{actionError}</Text>}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
