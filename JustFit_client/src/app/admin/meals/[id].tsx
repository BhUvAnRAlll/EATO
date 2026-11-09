import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useLocalSearchParams } from "expo-router";

import { MealForm } from "@/components/admin/MealForm";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { useGymSave } from "@/lib/gymForm";
import { kitchenApi } from "@/lib/mealsApi";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/meals"));

// Super Admin › Meals › a meal: every field editable (MealForm). Orders already placed keep the
// name, price and macros they were placed with.
export default function AdminEditMeal() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(async (token: string | null) => {
    const answer = await kitchenApi.meals(token);
    if (!answer.ok) return answer;
    const meal = answer.data.meals.find((m) => m.id === id);
    return meal ? { ok: true as const, data: meal } : { ok: false as const, error: "That meal was deleted.", status: 404 };
  }, [id]);
  const { result, retry } = useGymData(load);
  const { busy, error, save } = useGymSave(() => back(), "Meal saved");
  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title" accessibilityRole="header">Edit Meal</Text>
          <View className="screen-bar__spacer" />
        </View>
        {result.state === "loading" && <View className="px-4"><ScreenSkeleton label="Loading the meal" /></View>}
        {result.state === "failed" && (
          <View className="px-4">
            <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the meal" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
          </View>
        )}
        {result.state === "ready" && (
          <MealForm meal={result.data} busy={busy} error={error} saveLabel="Save changes" onSave={(input) => save((token) => kitchenApi.editMeal(token, result.data.id, input))} />
        )}
      </SafeAreaView>
    </View>
  );
}
