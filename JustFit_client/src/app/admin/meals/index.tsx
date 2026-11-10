import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";

import { AdminScreen } from "@/components/admin/AdminScreen";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { DietMark } from "@/components/meals/DietMark";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { hud } from "@/lib/hud";
import { TAG_LABEL, rupees } from "@/lib/mealRules";
import { kitchenApi, mealImage, type AdminMeal } from "@/lib/mealsApi";
import { confirmChoice, showActions } from "@/lib/nativeSheets";
import { useGymData } from "@/lib/useGymData";
import { useSessionToken } from "@/lib/session";
import { useAuthStore } from "@/store/auth";
import { useSwitchColors, useThemeColors } from "@/theme";
import type { Icon } from "@/types/profile";

type Link = { label: string; line: string; href: "/admin/kitchens" | "/admin/delivery" | "/admin/subscriptions" | "/admin/issues" | "/admin/reports" | "/admin/meal-ops" | "/admin/meals/categories" | "/admin/meals/banners" | "/admin/meals/coupons" | "/admin/meals/times"; icon: Icon };
const LINKS: Link[] = [
  { label: "Kitchens", line: "Where meals are cooked: hours, pincodes, staff", href: "/admin/kitchens", icon: { ios: "frying.pan", android: "skillet", web: "skillet" } },
  { label: "Subscriptions", line: "Meal plans and members' subscriptions", href: "/admin/subscriptions", icon: { ios: "calendar", android: "calendar_month", web: "calendar_month" } },
  { label: "Issues", line: "Members' reports: missing, wrong, late, refunds", href: "/admin/issues", icon: { ios: "exclamationmark.bubble", android: "report", web: "report" } },
  { label: "Reports", line: "Revenue, kitchens, delivery, subscriptions", href: "/admin/reports", icon: { ios: "chart.line.uptrend.xyaxis", android: "insights", web: "insights" } },
  { label: "Delivery", line: "Partners, who carries what, failed deliveries", href: "/admin/delivery", icon: { ios: "bicycle", android: "pedal_bike", web: "pedal_bike" } },
  { label: "Meal operations", line: "The day's orders, revenue and kitchens", href: "/admin/meal-ops", icon: { ios: "chart.bar", android: "bar_chart", web: "bar_chart" } },
  { label: "Categories", line: "Tiles and food categories on the Meals tab", href: "/admin/meals/categories", icon: { ios: "square.grid.2x2", android: "grid_view", web: "grid_view" } },
  { label: "Banners", line: "The big carousel, with dates", href: "/admin/meals/banners", icon: { ios: "photo.on.rectangle", android: "view_carousel", web: "view_carousel" } },
  { label: "Coupons", line: "Codes members apply at checkout", href: "/admin/meals/coupons", icon: { ios: "tag", android: "sell", web: "sell" } },
  { label: "Delivery times", line: "Breakfast, lunch and dinner", href: "/admin/meals/times", icon: { ios: "clock", android: "schedule", web: "schedule" } },
];

// Super Admin › Orders › Meals: the menu and everything around it. The links (kitchens, meal
// operations, categories, banners, coupons, delivery times), Add Meal, then every meal: tap to edit, the switch shows or
// hides it on the menu, ⋯ opens its recipe, makes a hidden copy or deletes it (orders already
// placed keep their copy).
export default function AdminMeals() {
  const colors = useThemeColors();
  const switchColors = useSwitchColors();
  const getToken = useSessionToken();
  const token = useAuthStore((state) => state.token);
  const { result, retry, refresh, update } = useGymData(kitchenApi.meals);
  const [busyId, setBusyId] = useState<string | null>(null);

  const remove = async (meal: AdminMeal) => {
    if (busyId) return;
    const sure = await confirmChoice({
      title: `Delete ${meal.name}?`,
      message: meal.openOrders > 0
        ? `It leaves the menu now. The ${meal.openOrders} open ${meal.openOrders === 1 ? "order" : "orders"} with it stay as they are. To take it off for a while, switch it off instead.`
        : "It leaves the menu now. Past orders keep it as they were. To take it off for a while, switch it off instead.",
      confirmLabel: "Delete meal",
      destructive: true,
    });
    if (!sure) return;
    setBusyId(meal.id);
    const answer = await kitchenApi.deleteMeal(await getToken(), meal.id);
    setBusyId(null);
    if (!answer.ok) return hud.error(answer.error);
    update((data) => ({ meals: data.meals.filter((m) => m.id !== meal.id) }));
    hud.success("Meal deleted");
  };

  const setVisible = async (meal: AdminMeal, available: boolean) => {
    if (busyId) return;
    setBusyId(meal.id);
    update((data) => ({ meals: data.meals.map((m) => (m.id === meal.id ? { ...m, available } : m)) }));
    const answer = await kitchenApi.setVisible(await getToken(), meal.id, available);
    setBusyId(null);
    if (!answer.ok) {
      update((data) => ({ meals: data.meals.map((m) => (m.id === meal.id ? { ...m, available: !available } : m)) }));
      return hud.error(answer.error);
    }
    hud.success(available ? "Shown on the menu" : "Hidden from the menu");
  };

  // A hidden copy (with its recipe and kitchens) that opens to edit
  const duplicate = async (meal: AdminMeal) => {
    if (busyId) return;
    setBusyId(meal.id);
    const answer = await kitchenApi.duplicateMeal(await getToken(), meal.id);
    setBusyId(null);
    if (!answer.ok) return hud.error(answer.error);
    update((data) => ({ meals: [answer.data.meal, ...data.meals] }));
    hud.success("Copy made · hidden");
    router.push({ pathname: "/admin/meals/[id]", params: { id: answer.data.meal.id } });
  };
  const more = (meal: AdminMeal) =>
    showActions({
      title: meal.name,
      actions: [
        { label: "Recipe and prep time", onPress: () => router.push({ pathname: "/admin/meals/recipe", params: { id: meal.id } }) },
        { label: "Duplicate", onPress: () => void duplicate(meal) },
        { label: "Delete meal", destructive: true, onPress: () => void remove(meal) },
      ],
    });

  const meals = result.state === "ready" ? result.data.meals : [];
  const shown = meals.filter((m) => m.available).length;
  return (
    <AdminScreen title="Meals" onRefresh={refresh}>
      <View style={{ gap: 14 }}>
        <View className="admin-list">
          {LINKS.map((l, i) => (
            <Pressable key={l.href} onPress={() => router.push(l.href)} className={i === 0 ? "admin-row" : "admin-row admin-row--divided"} accessibilityRole="button">
              <View className="admin-row__icon"><SymbolView name={l.icon} size={17} tintColor={colors.primaryText} /></View>
              <View className="min-w-0 flex-1">
                <Text className="card__title">{l.label}</Text>
                <Text className="meta-text" numberOfLines={1}>{l.line}</Text>
              </View>
              <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
            </Pressable>
          ))}
        </View>

        <Pressable onPress={() => router.push("/admin/meals/new")} className="btn-forest" accessibilityRole="button">
          <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={14} tintColor={colors.onPrimary} />
          <Text className="btn-forest__label">Add Meal</Text>
        </Pressable>

        {result.state === "loading" && <ScreenSkeleton label="Loading meals" />}
        {result.state === "failed" && (
          <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load meals" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
        )}
        {result.state === "ready" && meals.length === 0 && (
          <DashedBlock icon={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }} title="No meals yet" text="Add your first meal. Members see it on the Meals tab at once." onPress={() => router.push("/admin/meals/new")} />
        )}
        {meals.length > 0 && (
          <>
            <Text className="meta-text">{`${meals.length} ${meals.length === 1 ? "meal" : "meals"} · ${shown} on the menu`}</Text>
            <View className="admin-list">
              {meals.map((m, i) => (
                <View key={m.id} className={i === 0 ? "admin-row" : "admin-row admin-row--divided"} style={{ opacity: m.available ? 1 : 0.6 }}>
                  <Pressable onPress={() => router.push({ pathname: "/admin/meals/[id]", params: { id: m.id } })} className="min-w-0 flex-1 flex-row items-center" style={{ gap: 12 }} accessibilityRole="button" accessibilityLabel={`Edit ${m.name}`}>
                    <View className="overflow-hidden rounded-md" style={{ width: 56, height: 56, backgroundColor: colors.creamDeep }}>
                      <Image source={mealImage(m.imageUrl, token)} contentFit="cover" style={{ width: "100%", height: "100%" }} />
                    </View>
                    <View className="min-w-0 flex-1" style={{ gap: 2 }}>
                      <View className="flex-row items-center" style={{ gap: 6 }}>
                        <DietMark diet={m.diet} />
                        <Text className="card__title flex-1" numberOfLines={1}>{m.name}</Text>
                      </View>
                      <Text className="meta-text" numberOfLines={1}>{`${rupees(m.price)}${m.mrp ? ` (was ${rupees(m.mrp)})` : ""} · ${m.calories} kcal · ${Math.round(m.proteinG)}g P`}</Text>
                      <Text className="meta-text" numberOfLines={1}>
                        {[m.available ? null : "Hidden", ...m.tags.map((t) => TAG_LABEL[t]), m.openOrders > 0 ? `${m.openOrders} open ${m.openOrders === 1 ? "order" : "orders"}` : null].filter(Boolean).join(" · ") || "On the menu"}
                      </Text>
                    </View>
                  </Pressable>
                  <Switch value={m.available} onValueChange={(v) => setVisible(m, v)} disabled={busyId === m.id} {...switchColors} accessibilityLabel={`Show ${m.name} on the menu`} />
                  <Pressable onPress={() => more(m)} disabled={busyId === m.id} hitSlop={8} className="admin-row__icon" accessibilityRole="button" accessibilityLabel={`More for ${m.name}`}>
                    <SymbolView name={{ ios: "ellipsis", android: "more_horiz", web: "more_horiz" }} size={17} tintColor={colors.ink} />
                  </Pressable>
                </View>
              ))}
            </View>
          </>
        )}
      </View>
    </AdminScreen>
  );
}
