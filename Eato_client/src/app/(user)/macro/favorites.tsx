import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { DashedBlock } from "@/components/macro/DashedBlock";
import { FoodCard } from "@/components/macro/FoodCard";
import { MacroHeader } from "@/components/macro/MacroHeader";
import { Segmented } from "@/components/macro/Segmented";
import { loggedAtFor, macro, slotForNow, slotInfo, slots, todayIso, type Favorite, type Slot } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { useMacroStore } from "@/store/macro";
import { colors } from "@/theme";

// Pick a food hearted earlier and log it in one tap. Reached through Add meal → Log food (the
// slot and time come along) or opened directly, when it asks for the slot itself.
export default function Favorites() {
  const params = useLocalSearchParams<{ slot?: string; hour?: string; minute?: string }>();
  const getToken = useSessionToken();
  const { width } = useWindowDimensions();
  const selectedDate = useMacroStore((state) => state.selectedDate);
  const upstreamSlot = slots.includes(params.slot as Slot) ? (params.slot as Slot) : null;
  const [favorites, setFavorites] = useState<Favorite[] | null>(null);
  const [selected, setSelected] = useState<Favorite | null>(null);
  const [slot, setSlot] = useState<Slot>(upstreamSlot ?? slotForNow());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Two per row, never wider than 200
  const cardWidth = Math.min(200, Math.floor((width - 40 - 12) / 2));

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const result = await macro.favorites(await getToken().catch(() => null));
        if (cancelled) return;
        if (result.ok) setFavorites(result.data.favorites);
        else setError(result.error);
      })();
      return () => {
        cancelled = true;
      };
    }, [getToken]),
  );

  // The heart removes the favourite at once and puts it back if the server says no
  const unheart = async (favorite: Favorite) => {
    setError(null);
    setFavorites((current) => current?.filter((f) => f.id !== favorite.id) ?? null);
    if (selected?.id === favorite.id) setSelected(null);
    const result = await macro.removeFavorite(await getToken().catch(() => null), favorite.id);
    if (!result.ok) {
      setFavorites((current) => (current ? [favorite, ...current] : [favorite]));
      setError("Couldn't remove that favourite. Please try again.");
    }
  };

  const logIt = async () => {
    if (!selected || saving) return;
    setError(null);
    if (selectedDate !== todayIso()) return setError("Meals can only be logged for today.");
    setSaving(true);
    const result = await macro.logFavorite(await getToken().catch(() => null), selected.id, {
      date: selectedDate,
      slot: upstreamSlot ?? slot,
      loggedAt: loggedAtFor(selectedDate, params.hour, params.minute),
    });
    setSaving(false);
    if (!result.ok) return setError(result.status ? result.error : "Could not log that favourite.");
    router.dismissTo("/macro"); // the Macro tab reloads the day when it comes back into view
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <MacroHeader title="Favourites" />
        {favorites === null ? (
          <View className="flex-1 items-center justify-center">
            {error ? <Text className="macro__error px-5 text-center" accessibilityRole="alert">{error}</Text> : <ActivityIndicator color={colors.forest} />}
          </View>
        ) : (
          <>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 16 }} showsVerticalScrollIndicator={false}>
              {favorites.length === 0 ? (
                <DashedBlock icon={{ ios: "heart", android: "favorite_border", web: "favorite_border" }} title="No favourites yet" text="Tap the heart on a recent meal to save it here." />
              ) : (
                <View className="flex-row flex-wrap gap-3" accessibilityRole="radiogroup">
                  {favorites.map((favorite) => (
                    <FoodCard
                      key={favorite.id}
                      name={favorite.name}
                      kcal={favorite.totals.kcal}
                      width={cardWidth}
                      selected={selected?.id === favorite.id}
                      onSelect={() => setSelected(favorite)}
                      onUnheart={() => unheart(favorite)}
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
                <Pressable onPress={logIt} disabled={saving} className="btn-forest" style={{ opacity: saving ? 0.7 : 1 }} accessibilityRole="button" accessibilityLabel={`Log ${selected.name}`}>
                  {saving ? <ActivityIndicator color={colors.white} /> : <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={16} tintColor={colors.white} />}
                  <Text className="btn-forest__label" numberOfLines={1}>Log {selected.name}</Text>
                </Pressable>
              </View>
            )}
          </>
        )}
      </SafeAreaView>
    </View>
  );
}
