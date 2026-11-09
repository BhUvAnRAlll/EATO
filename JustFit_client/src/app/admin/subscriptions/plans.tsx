import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";

import { AdminScreen } from "@/components/admin/AdminScreen";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { rupees } from "@/lib/mealRules";
import { useGymData } from "@/lib/useGymData";
import { subscriptionsApi } from "@/lib/subscriptionsApi";
import { useThemeColors } from "@/theme";

// Super Admin › Subscriptions › Plans (Meal Operations phase 5): every meal plan (hidden ones too),
// with its lengths and prices; + adds one, a row edits it
export default function AdminPlans() {
  const colors = useThemeColors();
  const { result, retry, refresh } = useGymData(subscriptionsApi.adminPlans);
  return (
    <AdminScreen
      title="Meal plans"
      onRefresh={refresh}
      headerRight={
        <Pressable onPress={() => router.push("/admin/subscriptions/plan")} hitSlop={8} className="admin-chip admin-chip--on flex-row" style={{ gap: 4 }} accessibilityRole="button" accessibilityLabel="Add plan">
          <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={14} tintColor={colors.primaryText} />
          <Text className="admin-segment__label admin-segment__label--on">Add</Text>
        </Pressable>
      }
    >
      {result.state === "loading" && <ScreenSkeleton label="Loading plans" />}
      {result.state === "failed" && (
        <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load plans" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
      )}
      {result.state === "ready" && result.data.plans.length === 0 && <DashedBlock icon={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }} title="No plans yet" text="Add the plans members can subscribe to." onPress={() => router.push("/admin/subscriptions/plan")} />}
      {result.state === "ready" && result.data.plans.length > 0 && (
        <View className="admin-list">
          {result.data.plans.map((p, i) => (
            <Pressable key={p.id} onPress={() => router.push({ pathname: "/admin/subscriptions/plan", params: { id: String(p.id) } })} className={i === 0 ? "admin-row" : "admin-row admin-row--divided"} style={{ opacity: p.active ? 1 : 0.6 }} accessibilityRole="button">
              <View className="min-w-0 flex-1">
                <Text className="card__title" numberOfLines={1}>{`${p.name}${p.active ? "" : " · hidden"}`}</Text>
                <Text className="meta-text" numberOfLines={1}>{`${p.mealsPerDay} meals a day · ${p.calories} kcal · ${p.mealIds.length} meals`}</Text>
                <Text className="meta-text" numberOfLines={1}>{p.lengths.map((l) => `${l.days} days ${rupees(l.price)}`).join(" · ")}</Text>
              </View>
              <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
            </Pressable>
          ))}
        </View>
      )}
    </AdminScreen>
  );
}
