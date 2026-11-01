import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { DashedBlock } from "@/components/macro/DashedBlock";
import { FoodCard } from "@/components/macro/FoodCard";
import { MacroHeader } from "@/components/macro/MacroHeader";
import { Segmented } from "@/components/macro/Segmented";
import { dayLabel, loggedAtFor, macro, slotForNow, slotInfo, slots, todayIso, type Meal, type Slot } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { useMacroStore } from "@/store/macro";
import { useThemeColors } from "@/theme";
import { track } from "@/lib/analytics";

// Re-log anything from the last 3 days as a new meal today. The foods are copied, so changing
// or removing the original later leaves the repeat as it was. Asks for the slot only when
// the screen was opened without one.
export default function RepeatMeal() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ slot?: string; hour?: string; minute?: string }>();
  const getToken = useSessionToken();
  const { width } = useWindowDimensions();
  const selectedDate = useMacroStore((state) => state.selectedDate);
  const upstreamSlot = slots.includes(params.slot as Slot) ? (params.slot as Slot) : null;
  const [recent, setRecent] = useState<Meal[] | null>(null);
  const [selected, setSelected] = useState<Meal | null>(null);
  const [slot, setSlot] = useState<Slot>(upstreamSlot ?? slotForNow());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const today = todayIso();
  const cardWidth = Math.min(200, Math.floor((width - 32 - 12) / 2));

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const result = await macro.recent(await getToken().catch(() => null), todayIso(), 12);
        if (cancelled) return;
        if (result.ok) setRecent(result.data.meals);
        else setError(result.error);
      })();
      return () => {
        cancelled = true;
      };
    }, [getToken]),
  );

  const repeat = async () => {
    if (!selected || saving) return;
    setError(null);
    if (selectedDate !== todayIso()) return setError("Meals can only be logged for today.");
    setSaving(true);
    const result = await macro.logMeal(await getToken().catch(() => null), {
      date: selectedDate,
      slot: upstreamSlot ?? slot,
      title: selected.title,
      loggedAt: loggedAtFor(selectedDate, params.hour, params.minute),
      source: "repeat",
      items: selected.items,
    });
    setSaving(false);
    if (!result.ok) return setError(result.status ? result.error : "Could not repeat that meal.");
    track("meal_logged", { source: "repeat" });
    router.dismissTo("/macro"); // the Macro tab reloads the day when it comes back into view
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <MacroHeader title="Repeat a meal" />
        {recent === null ? (
          error ? (
            <View className="flex-1 items-center justify-center">
              <Text className="macro__error px-5 text-center" accessibilityRole="alert">{error}</Text>
            </View>
          ) : (
            <View className="px-4 pt-2">
              <ScreenSkeleton />
            </View>
          )
        ) : (
          <>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 16 }} showsVerticalScrollIndicator={false}>
              <Text className="home__lead">Anything from the last 3 days — pick one to log it again today.</Text>
              {recent.length === 0 ? (
                <DashedBlock icon={{ ios: "arrow.clockwise", android: "refresh", web: "refresh" }} title="Nothing to repeat yet" text="Meals you log in the last 3 days will show up here." />
              ) : (
                <View className="flex-row flex-wrap gap-3" accessibilityRole="radiogroup">
                  {recent.map((meal) => (
                    <FoodCard
                      key={meal.id}
                      name={meal.title}
                      kcal={meal.totals.kcal}
                      width={cardWidth}
                      dayLabel={dayLabel(meal.date, today)}
                      selected={selected?.id === meal.id}
                      onSelect={() => setSelected(meal)}
                    />
                  ))}
                </View>
              )}
              {selected && !upstreamSlot && (
                <View className="gap-2">
                  <Text className="setup__section">Add to</Text>
                  <Segmented options={slots.map((s) => ({ value: s, label: slotInfo[s].label }))} value={slot} onChange={setSlot} label="Meal slot" />
                </View>
              )}
              {error && <Text className="macro__error" accessibilityRole="alert">{error}</Text>}
            </ScrollView>
            {selected && (
              <View className="px-5 pb-3 pt-2">
                <Pressable onPress={repeat} disabled={saving} className="btn-forest" style={{ opacity: saving ? 0.7 : 1 }} accessibilityRole="button" accessibilityLabel={`Repeat ${selected.title}`}>
                  {saving ? <ActivityIndicator color={colors.white} /> : <SymbolView name={{ ios: "arrow.clockwise", android: "refresh", web: "refresh" }} size={16} tintColor={colors.white} />}
                  <Text className="btn-forest__label" numberOfLines={1}>Repeat {selected.title}</Text>
                </Pressable>
              </View>
            )}
          </>
        )}
      </SafeAreaView>
    </View>
  );
}
