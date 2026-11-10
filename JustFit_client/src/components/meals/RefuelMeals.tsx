import { useEffect, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";

import { RecommendedMeals } from "@/components/meals/RecommendedMeals";
import { refuelMeals, refuelReason } from "@/lib/mealMatch";
import { useSessionToken } from "@/lib/session";
import { useMyFood } from "@/store/myFood";
import { useStorefront } from "@/store/storefront";

// Refuel after your workout (marketing phase 2, 2026-11-10): on the gym check-out card, two
// protein-rich menu meals to order, never against the member's diet or allergies (lib/mealMatch.ts,
// on the phone: no AI, no cost). Nothing shows until the menu and food answers are read, or when
// no meal suits them.
export function RefuelMeals() {
  const getToken = useSessionToken();
  const menu = useStorefront((state) => state.load);
  const readMenu = useStorefront((state) => state.read);
  const food = useMyFood((state) => state.food);
  const foodRead = useMyFood((state) => state.read);
  const loadFood = useMyFood((state) => state.load);

  useEffect(() => {
    (async () => {
      const token = await getToken().catch(() => null);
      readMenu(token);
      loadFood(token);
    })();
  }, [getToken, readMenu, loadFood]);

  const items = useMemo(
    () => (menu.state === "ready" && foodRead ? refuelMeals(menu.data.meals, food).map((m) => ({ meal: m.meal, note: refuelReason(m.meal) })) : []),
    [menu, food, foodRead],
  );
  if (items.length === 0) return null;
  return (
    <View className="self-stretch" style={{ gap: 10 }}>
      <View className="flex-row items-center justify-between">
        <Text className="card__title">Refuel after your workout</Text>
        <Pressable onPress={() => router.navigate("/meals")} hitSlop={10} accessibilityRole="link">
          <Text className="meal-link">All meals</Text>
        </Pressable>
      </View>
      <RecommendedMeals items={items} />
    </View>
  );
}
