import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect } from "expo-router";

import { EmptyState, PostSkeleton } from "@/components/community/CommunityStates";
import { FormAlert } from "@/components/FormAlert";
import { timeAgo } from "@/lib/community";
import { todayIso } from "@/lib/macro";
import { mealSlotLabels, planGoalLabels } from "@/lib/trainerRules";
import { trainers, type MyPlan } from "@/lib/trainers";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

const statusLabels = { pending: "Pending", logged: "Logged", done: "Done · not logged" } as const;

// The diet plan the trainer shared: today's progress, then the five meals with their foods,
// planned macros and status. Log Meal opens the logging screen (servings can be adjusted);
// Mark done records a meal as eaten without counting it toward the macros. Values are
// illustrative, as the trainer entered them.
export default function DietPlanScreen() {
  const getToken = useSessionToken();
  const [data, setData] = useState<MyPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const today = todayIso();

  const load = useCallback(async () => {
    const result = await trainers.myPlan(await getToken(), todayIso());
    if (result.ok) {
      setData(result.data);
      setError(null);
    } else setError(result.error);
  }, [getToken]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(load, 0);
      return () => clearTimeout(timer);
    }, [load]),
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const toggleDone = async (mealId: string, done: boolean) => {
    setBusy(mealId);
    const result = await trainers.setDone(await getToken(), mealId, today, done);
    setBusy(null);
    if (!result.ok) return setError(result.error);
    await load();
  };

  const plan = data?.plan ?? null;

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View className="h-12 flex-row items-center px-5">
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
          </Pressable>
          <Text className="type-subhead ml-3 flex-1 text-forest-ink">Diet Plan</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.forest} />}>
          {error && <Pressable onPress={() => setError(null)}><FormAlert message={error} /></Pressable>}
          {data === null ? (
            error ? null : <PostSkeleton />
          ) : !plan ? (
            <EmptyState
              icon={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }}
              title={data.state === "connected" ? "No plan shared yet" : "Locked"}
              text={data.state === "connected" ? "Your trainer hasn't shared a diet plan yet." : data.state === "requested" ? "Your diet plan unlocks when your trainer accepts your request." : "Connect with a trainer who offers nutrition coaching to get a diet plan."}
            />
          ) : (
            <>
              <View className="post__card gap-1">
                <Text className="post__time">{`From ${plan.trainer.name} · updated ${timeAgo(plan.updatedAt)}`}</Text>
                <Text className="type-headline text-forest-ink">{plan.name}</Text>
                <Text className="home__note">{[planGoalLabels[plan.goal], `from ${plan.startDate}`, plan.endDate ? `to ${plan.endDate}` : null].filter(Boolean).join(" · ")}</Text>
                {plan.notes && <Text className="post__body mt-2">{plan.notes}</Text>}
              </View>
              {data.progress && (
                <View className="post__card flex-row justify-between">
                  <View>
                    <Text className="post__author">{`${data.progress.mealsDone} of ${data.progress.mealsTotal} meals`}</Text>
                    <Text className="post__time">done today</Text>
                  </View>
                  <View className="items-end">
                    <Text className="post__author">{`${data.progress.loggedKcal} / ${data.progress.plannedKcal} kcal`}</Text>
                    <Text className="post__time">logged vs. planned</Text>
                  </View>
                </View>
              )}
              {plan.meals.map((meal) => (
                <View key={meal.id} className="post__card gap-2">
                  <View className="flex-row items-center justify-between">
                    <Text className="post__time">{`${mealSlotLabels[meal.slot]} · ${meal.time}`}</Text>
                    <View className={meal.status === "pending" ? "rounded-pill bg-cream-tab px-3 py-1" : "rounded-pill bg-forest-soft px-3 py-1"}>
                      <Text className="post__time" style={{ color: colors.forestInk }}>{meal.loggedCount > 1 ? `Logged ×${meal.loggedCount}` : statusLabels[meal.status]}</Text>
                    </View>
                  </View>
                  <Text className="post__author">{meal.name}</Text>
                  {meal.items.map((item, i) => (
                    <View key={i} className="flex-row justify-between">
                      <Text className="post__body flex-1" numberOfLines={1}>{`${item.name} · ${item.quantity} ${item.unit}`}</Text>
                      <Text className="post__time">{`${Math.round(item.kcal)} kcal`}</Text>
                    </View>
                  ))}
                  <Text className="home__note">{`${Math.round(meal.totals.kcal)} kcal · P ${meal.totals.proteinG} g · C ${meal.totals.carbsG} g · F ${meal.totals.fatG} g`}</Text>
                  {meal.note && <Text className="home__note">{meal.note}</Text>}
                  <View className="mt-1 flex-row gap-2">
                    <Pressable onPress={() => router.push({ pathname: "/community/trainers/log/[mealId]", params: { mealId: meal.id } })} className={meal.status === "logged" ? "group__join group__join--joined" : "group__join"} accessibilityRole="button" accessibilityLabel={meal.status === "logged" ? `Log ${meal.name} again` : `Log ${meal.name}`}>
                      <Text className={meal.status === "logged" ? "group__join-label group__join-label--joined" : "group__join-label"}>{meal.status === "logged" ? "Log again" : "Log Meal"}</Text>
                    </Pressable>
                    {meal.status !== "logged" && (
                      <Pressable onPress={() => toggleDone(meal.id, !meal.done)} disabled={busy === meal.id} className="admin__action" accessibilityRole="button" accessibilityLabel={meal.done ? `Undo done for ${meal.name}` : `Mark ${meal.name} done without logging`}>
                        {busy === meal.id ? <ActivityIndicator color={colors.forest} /> : <Text className="admin__action-label">{meal.done ? "Undo" : "Mark done"}</Text>}
                      </Pressable>
                    )}
                  </View>
                </View>
              ))}
              <Text className="home__note text-center">Nutrition values are as your trainer entered them, for guidance.</Text>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
