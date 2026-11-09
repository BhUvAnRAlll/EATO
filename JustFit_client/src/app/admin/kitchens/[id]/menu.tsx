import { useCallback, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { AdminScreen } from "@/components/admin/AdminScreen";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { hud } from "@/lib/hud";
import { kitchensApi, type KitchenMenuMeal } from "@/lib/kitchensApi";
import { useGymData } from "@/lib/useGymData";
import { useSessionToken } from "@/lib/session";
import { useSwitchColors } from "@/theme";

// Super Admin › Kitchens › a kitchen › Menu (Meal Operations phase 2): every meal on justFit's menu.
// "Cooks here" assigns the meal to this kitchen; "Available today" pauses it here only (out of an
// ingredient, a chef away). Each row says whether the meal has a recipe and a prep time yet.
// From phase 3 an order goes only to a kitchen that cooks every meal in it and has them available.
export default function KitchenMenu() {
  const switchColors = useSwitchColors();
  const getToken = useSessionToken();
  const { id } = useLocalSearchParams<{ id: string }>();
  const kitchenId = Number(id);
  const load = useCallback((t: string | null) => kitchensApi.menu(t, kitchenId), [kitchenId]);
  const { result, retry, refresh, update } = useGymData(load);
  const [busyId, setBusyId] = useState<string | null>(null);

  const set = async (meal: KitchenMenuMeal, cooks: boolean, available: boolean) => {
    if (busyId) return;
    setBusyId(meal.id);
    const answer = await kitchensApi.setMenu(await getToken(), kitchenId, meal.id, cooks, available);
    setBusyId(null);
    if (!answer.ok) return hud.error(answer.error);
    update((data) => {
      const meals = data.meals.map((m) => (m.id === meal.id ? answer.data.meal : m));
      return { meals, counts: { ...data.counts, cooks: meals.filter((m) => m.cooks).length, available: meals.filter((m) => m.available).length } };
    });
  };

  const data = result.state === "ready" ? result.data : null;
  return (
    <AdminScreen title="Menu" subtitle={data ? `Cooks ${data.counts.cooks} of ${data.counts.all} meals · ${data.counts.available} available` : undefined} onRefresh={refresh}>
      {result.state === "loading" && <ScreenSkeleton label="Loading the menu" />}
      {result.state === "failed" && (
        <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the menu" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
      )}
      {data && data.meals.length === 0 && <DashedBlock icon={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }} title="No meals yet" text="Add meals first (Meals › Add Meal)." />}
      {data && data.meals.length > 0 && (
        <View className="admin-list">
          {data.meals.map((m, i) => (
            <View key={m.id} className={i === 0 ? "admin-row" : "admin-row admin-row--divided"} style={{ alignItems: "flex-start", opacity: busyId === m.id ? 0.6 : 1 }}>
              <Pressable onPress={() => router.push({ pathname: "/admin/meals/recipe", params: { id: m.id } })} className="min-w-0 flex-1" accessibilityRole="button" accessibilityLabel={`${m.name} recipe`}>
                <Text className="card__title" numberOfLines={1}>{m.name}</Text>
                <Text className="meta-text" numberOfLines={1}>
                  {[m.onMenu ? null : "Hidden from members", m.prepMinutes ? `${m.prepMinutes} min` : "No prep time", m.recipeItems ? `${m.recipeItems} ingredients` : "No recipe"].filter(Boolean).join(" · ")}
                </Text>
              </Pressable>
              <View style={{ gap: 6, alignItems: "flex-end" }}>
                <View className="flex-row items-center" style={{ gap: 6 }}>
                  <Text className="meta-text">Cooks here</Text>
                  <Switch value={m.cooks} onValueChange={(v) => set(m, v, true)} disabled={!!busyId} {...switchColors} accessibilityLabel={`${m.name}: cooks here`} />
                </View>
                {m.cooks ? (
                  <View className="flex-row items-center" style={{ gap: 6 }}>
                    <Text className="meta-text">Available</Text>
                    <Switch value={m.available} onValueChange={(v) => set(m, true, v)} disabled={!!busyId} {...switchColors} accessibilityLabel={`${m.name}: available here`} />
                  </View>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      )}
    </AdminScreen>
  );
}
