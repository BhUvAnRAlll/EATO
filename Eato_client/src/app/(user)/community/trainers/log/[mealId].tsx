import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { EmptyState, PostSkeleton } from "@/components/community/CommunityStates";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { FormAlert } from "@/components/FormAlert";
import { todayIso } from "@/lib/macro";
import { mealSlotLabels, scaledTotals, stepServing } from "@/lib/trainerRules";
import { trainers, type TodayMeal } from "@/lib/trainers";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

// Log a plan meal into today's diary. Each food has a stepper in half servings (0 skips it);
// the totals follow at once. A meal already logged today says "Log again" and asks first, and
// the server keys each log by date and meal, so a double tap can never count twice.
export default function LogPlanMealScreen() {
  const { mealId } = useLocalSearchParams<{ mealId: string }>();
  const getToken = useSessionToken();
  const [meal, setMeal] = useState<TodayMeal | null>(null);
  const [missing, setMissing] = useState(false);
  const [servings, setServings] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmAgain, setConfirmAgain] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await trainers.myPlan(await getToken(), todayIso());
    if (!result.ok) return setError(result.error);
    const found = result.data.plan?.meals.find((m) => m.id === mealId) ?? null;
    setMeal(found);
    setMissing(!found);
    if (found) setServings((current) => (current.length === found.items.length ? current : found.items.map(() => 1)));
  }, [mealId, getToken]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(load, 0);
      return () => clearTimeout(timer);
    }, [load]),
  );

  const save = async (again: boolean) => {
    if (!meal) return;
    setSaving(true);
    setError(null);
    const result = await trainers.logPlanMeal(await getToken(), meal.id, { date: todayIso(), servings, again });
    setSaving(false);
    setConfirmAgain(false);
    if (!result.ok) return setError(result.error);
    router.back();
  };

  const totals = meal ? scaledTotals(meal.items, servings) : null;
  const planned = meal?.totals ?? null;
  const changed = servings.some((s) => s !== 1);
  const alreadyLogged = (meal?.loggedCount ?? 0) > 0;
  const nothing = servings.length > 0 && servings.every((s) => s === 0);

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right", "bottom"]}>
        <View className="h-12 flex-row items-center px-5">
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
          </Pressable>
          <Text className="type-subhead ml-3 flex-1 text-forest-ink">Log Meal</Text>
        </View>
        {missing ? (
          <View className="px-5 pt-4"><EmptyState icon={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }} title="Meal not found" text="This meal is no longer in your plan." actionLabel="Back" onAction={() => router.back()} /></View>
        ) : !meal || !totals || !planned ? (
          <View className="px-5 pt-4"><PostSkeleton /></View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}>
            <View>
              <Text className="post__time">{`${mealSlotLabels[meal.slot]} · ${meal.time}`}</Text>
              <Text className="type-headline text-forest-ink">{meal.name}</Text>
            </View>
            {meal.items.map((item, i) => (
              <View key={i} className="post__card flex-row items-center gap-3">
                <View className="flex-1">
                  <Text className="post__author" numberOfLines={1}>{item.name}</Text>
                  <Text className="post__time">{`${item.quantity} ${item.unit} per serving · ${Math.round(item.kcal)} kcal`}</Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <Pressable onPress={() => setServings((s) => s.map((v, j) => (j === i ? stepServing(v, -1) : v)))} className="home__icon-button" accessibilityRole="button" accessibilityLabel={`Less ${item.name}`}>
                    <SymbolView name={{ ios: "minus", android: "remove", web: "remove" }} size={16} tintColor={colors.forestInk} />
                  </Pressable>
                  <Text className="post__author w-10 text-center" accessibilityLabel={`${servings[i] ?? 1} servings of ${item.name}`}>{`×${servings[i] ?? 1}`}</Text>
                  <Pressable onPress={() => setServings((s) => s.map((v, j) => (j === i ? stepServing(v, 1) : v)))} className="home__icon-button" accessibilityRole="button" accessibilityLabel={`More ${item.name}`}>
                    <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={16} tintColor={colors.forestInk} />
                  </Pressable>
                </View>
              </View>
            ))}
            {changed && (
              <Pressable onPress={() => setServings(meal.items.map(() => 1))} className="self-start" accessibilityRole="button" accessibilityLabel="Reset to planned amounts">
                <Text className="home__note" style={{ color: colors.leaf }}>Reset to planned amounts</Text>
              </Pressable>
            )}
            <View className="post__card gap-1">
              <Text className="setup__section">This meal</Text>
              <Text className="post__author">{`${Math.round(totals.kcal)} kcal · P ${totals.proteinG} g · C ${totals.carbsG} g · F ${totals.fatG} g`}</Text>
              {changed && <Text className="home__note">{`Planned: ${Math.round(planned.kcal)} kcal · P ${planned.proteinG} g · C ${planned.carbsG} g · F ${planned.fatG} g`}</Text>}
            </View>
            {error && <FormAlert message={error} />}
            <Pressable onPress={() => (alreadyLogged ? setConfirmAgain(true) : save(false))} disabled={saving || nothing} className="btn-forest" style={{ opacity: saving || nothing ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel={alreadyLogged ? "Log again" : `Log Meal, ${Math.round(totals.kcal)} kcal`}>
              {saving ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">{alreadyLogged ? `Log again · ${Math.round(totals.kcal)} kcal` : `Log Meal · ${Math.round(totals.kcal)} kcal`}</Text>}
            </Pressable>
            {nothing && <Text className="home__note text-center">Keep at least one food to log the meal.</Text>}
          </ScrollView>
        )}
      </SafeAreaView>
      <ConfirmSheet visible={confirmAgain} title="Log this meal again?" text="It's already in today's diary. Logging again adds a second entry." confirmLabel="Log again" busy={saving} onConfirm={() => save(true)} onCancel={() => setConfirmAgain(false)} />
    </View>
  );
}
