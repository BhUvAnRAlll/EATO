import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { MacroHeader } from "@/components/macro/MacroHeader";
import { MealDetailSheet } from "@/components/macro/MealDetailSheet";
import { dayLabel, macro, slotInfo, todayIso, whole, type Meal } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

// Logging, step two: how to log. Forwards { slot, hour, minute } unchanged to the method
// picked. Writes nothing except the heart on a recent meal.
export default function LogFood() {
  const params = useLocalSearchParams<{ slot?: string; hour?: string; minute?: string }>();
  const getToken = useSessionToken();
  const [recent, setRecent] = useState<Meal[]>([]);
  // "meal:<id>" keys that are already favourites
  const [hearted, setHearted] = useState<Set<string>>(new Set());
  const [openMeal, setOpenMeal] = useState<Meal | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const today = todayIso();
  const forward = { slot: params.slot ?? "", hour: params.hour ?? "", minute: params.minute ?? "" };

  const load = useCallback(async () => {
    const token = await getToken().catch(() => null);
    const [recentResult, favoritesResult] = await Promise.all([macro.recent(token, todayIso(), 12), macro.favorites(token)]);
    if (recentResult.ok) setRecent(recentResult.data.meals);
    if (favoritesResult.ok) setHearted(new Set(favoritesResult.data.favorites.map((f) => f.sourceKey).filter((k): k is string => !!k)));
  }, [getToken]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // The heart: updates at once, then follows the server's answer
  const toggleHeart = async (meal: Meal) => {
    const key = `meal:${meal.id}`;
    const was = hearted.has(key);
    const flip = (on: boolean) => setHearted((current) => { const next = new Set(current); if (on) next.add(key); else next.delete(key); return next; });
    flip(!was);
    setNotice(null);
    const result = await macro.toggleFavorite(await getToken().catch(() => null), { name: meal.title, items: meal.items, sourceKey: key });
    if (result.ok) flip(result.data.favorited);
    else {
      flip(was);
      setNotice(was ? "Couldn't remove that favourite. Please try again." : "Couldn't save that favourite. Please try again.");
    }
  };

  const go = (pathname: "/macro/scan" | "/macro/manual" | "/macro/favorites" | "/macro/repeat-meal") => router.push({ pathname, params: forward });

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <MacroHeader title="Log food" />
        <ScrollView contentContainerStyle={{ paddingBottom: 24, gap: 18 }} showsVerticalScrollIndicator={false}>
          <View className="gap-3 px-5">
            <Text className="type-headline text-forest-ink">How would you like to log?</Text>

            <Pressable onPress={() => go("/macro/scan")} className="home__card flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel="Scan food: estimate calories and macros from a photo">
              <View className="macro__thumb" style={{ backgroundColor: colors.forestSoft }}>
                <SymbolView name={{ ios: "camera.viewfinder", android: "photo_camera", web: "photo_camera" }} size={22} tintColor={colors.forest} />
              </View>
              <View className="flex-1">
                <Text className="card__title">Scan Food</Text>
                <Text className="post__time">Snap a photo, we estimate the macros</Text>
              </View>
              <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={16} tintColor={colors.faint} />
            </Pressable>

            <Pressable onPress={() => go("/macro/manual")} className="home__card flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel="Manual entry: type calories and macros">
              <View className="macro__thumb" style={{ backgroundColor: colors.forestSoft }}>
                <SymbolView name={{ ios: "square.and.pencil", android: "edit_note", web: "edit_note" }} size={22} tintColor={colors.forest} />
              </View>
              <View className="flex-1">
                <Text className="card__title">Manual Entry</Text>
                <Text className="post__time">Type calories & macros</Text>
              </View>
              <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={16} tintColor={colors.faint} />
            </Pressable>

            <View className="flex-row gap-3">
              <Pressable onPress={() => go("/macro/favorites")} className="macro__pill flex-1" accessibilityRole="button" accessibilityLabel="Favourites">
                <SymbolView name={{ ios: "heart.fill", android: "favorite", web: "favorite" }} size={16} tintColor={colors.danger} />
                <Text className="setup__chip-label">Favourites</Text>
              </Pressable>
              <Pressable onPress={() => go("/macro/repeat-meal")} className="macro__pill flex-1" accessibilityRole="button" accessibilityLabel="Repeat meal">
                <SymbolView name={{ ios: "arrow.clockwise", android: "refresh", web: "refresh" }} size={16} tintColor={colors.forest} />
                <Text className="setup__chip-label">Repeat meal</Text>
              </Pressable>
            </View>
            {notice && <Text className="macro__error" accessibilityRole="alert">{notice}</Text>}
          </View>

          {recent.length > 0 && (
            <View className="gap-3">
              <Text className="setup__section px-5">Recent meals</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
                {recent.map((meal) => {
                  const info = slotInfo[meal.slot];
                  const isHearted = hearted.has(`meal:${meal.id}`);
                  return (
                    <View key={meal.id} className="macro__food-card">
                      <Pressable onPress={() => setOpenMeal(meal)} className="gap-2" accessibilityRole="button" accessibilityLabel={`${meal.title}, ${whole(meal.totals.kcal)} kcal, ${dayLabel(meal.date, today)}`}>
                        <View className="macro__food-art" style={{ backgroundColor: `${info.tint}1F` }}>
                          <SymbolView name={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }} size={26} tintColor={info.tint} />
                        </View>
                        <Text className="card__title" numberOfLines={1}>{meal.title}</Text>
                        <Text className="post__time">{whole(meal.totals.kcal)} kcal · {dayLabel(meal.date, today)}</Text>
                      </Pressable>
                      {/* A sibling of the card, not inside it (no button inside a button) */}
                      <Pressable onPress={() => toggleHeart(meal)} hitSlop={8} className="macro__heart" accessibilityRole="button" accessibilityState={{ selected: isHearted }} accessibilityLabel={isHearted ? `Remove ${meal.title} from favourites` : `Save ${meal.title} to favourites`}>
                        <SymbolView name={{ ios: isHearted ? "heart.fill" : "heart", android: isHearted ? "favorite" : "favorite_border", web: isHearted ? "favorite" : "favorite_border" }} size={16} tintColor={isHearted ? colors.danger : colors.muted} />
                      </Pressable>
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>

      <MealDetailSheet
        meal={openMeal}
        onClose={() => setOpenMeal(null)}
        onDeleted={(meal) => setRecent((current) => current.filter((m) => m.id !== meal.id))}
        favorited={openMeal ? hearted.has(`meal:${openMeal.id}`) : false}
        onToggleFavorite={toggleHeart}
      />
    </View>
  );
}
