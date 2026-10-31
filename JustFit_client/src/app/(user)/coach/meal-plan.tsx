import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect } from "expo-router";

import { SymbolView } from "@/components/SymbolView";
import { CoachButton } from "@/components/coach/CoachButton";
import { PlanTimeline } from "@/components/coach/PlanTimeline";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { coaches } from "@/data/coach";
import { track } from "@/lib/analytics";
import { coachApi, type Intake, type IntakePrefill, type PlanState } from "@/lib/coach";
import { todayIso } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { useCoachIntakeStore } from "@/store/coachIntake";
import { colors } from "@/theme";

const OFFLINE = "Could not reach justFit. Check your connection and try again.";

const back = () => (router.canGoBack() ? router.back() : router.replace("/coach"));

// The coach's Meal Plan for today, on its own: the five meals down a timeline (time, slot, dish,
// ingredients, calories, macros, Swap, Log Meal), with "N Meals · kcal" in the header and the
// Adjust Plan banner at the bottom (ask the coach to adjust a meal, regenerate with AI Coach, or
// edit the answers). Swap replaces one meal with a new dish (a small AI call) instead of remaking
// the whole day. The workout is not here: it has its own card on the Coach tab.
export default function MealPlanScreen() {
  const getToken = useSessionToken();
  const start = useCoachIntakeStore((state) => state.start);
  const [loaded, setLoaded] = useState<{ intake: Intake | null; prefill: IntakePrefill } | null>(null);
  const [plan, setPlan] = useState<PlanState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [logging, setLogging] = useState<string | null>(null);
  const [swapping, setSwapping] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [adjusting, setAdjusting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const token = await getToken().catch(() => null);
    const [intake, planResult] = await Promise.all([coachApi.intake(token), coachApi.plan(token, todayIso())]);
    if (!intake.ok) return setError(intake.status ? intake.error : OFFLINE);
    if (!planResult.ok) return setError(planResult.status ? planResult.error : OFFLINE);
    setLoaded(intake.data);
    setPlan(planResult.data);
  }, [getToken]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // A pull reads the intake and today's plan again
  const { refreshControl } = usePullToRefresh(load);

  const logMeal = async (mealId: string) => {
    if (logging) return;
    setActionError(null);
    setLogging(mealId);
    const result = await coachApi.logMeal(await getToken().catch(() => null), mealId, todayIso());
    setLogging(null);
    if (!result.ok) return setActionError(result.status ? result.error : OFFLINE);
    setPlan((current) =>
      current?.plan ? { ...current, plan: { ...current.plan, meals: current.plan.meals.map((m) => (m.id === mealId ? { ...m, logged: true } : m)) } } : current,
    );
  };

  // One meal at a time; the server answers the whole plan with the new dish in place
  const swapMeal = async (mealId: string) => {
    if (swapping || making) return;
    setActionError(null);
    setSwapping(mealId);
    const result = await coachApi.swapMeal(await getToken().catch(() => null), mealId, todayIso());
    if (result.ok) track("coach_meal_swapped");
    setSwapping(null);
    if (!result.ok) return setActionError(result.status ? result.error : OFFLINE);
    setPlan({ state: result.data.state, plan: result.data.plan, workout: result.data.workout });
  };

  const regenerate = async () => {
    if (making || swapping) return;
    setActionError(null);
    setMaking(true);
    const result = await coachApi.makePlan(await getToken().catch(() => null), todayIso());
    if (result.ok) track("coach_plan_made");
    setMaking(false);
    if (!result.ok) return setActionError(result.status ? result.error : OFFLINE);
    setPlan(result.data);
  };

  const editAnswers = () => {
    if (!loaded) return;
    start(loaded.intake, loaded.prefill);
    router.push("/coach/intake/goal");
  };

  const coach = coaches.find((c) => c.id === loaded?.intake?.coach);
  const askCoach = () => router.push({ pathname: "/coach/chat", params: { name: coach?.name ?? "Your coach", ...(coach ? { coach: coach.id } : {}), q: "Adjust my diet" } });
  const meals = plan?.plan?.meals ?? [];

  return (
    <View className="coach__page">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View className="h-14 flex-row items-center px-4" style={{ gap: 12 }}>
          <Pressable onPress={back} className="coach__circle-btn" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "arrow.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
          </Pressable>
          <Text className="coach__title flex-1" style={{ fontSize: 24, lineHeight: 30 }} accessibilityRole="header" numberOfLines={1}>Meal Plan</Text>
          {plan?.plan && (
            <View className="min-w-0 flex-row items-center" style={{ gap: 10, flexShrink: 1 }}>
              <Text className="coach__hint" numberOfLines={1} style={{ flexShrink: 1 }}>{`${meals.length} Meals · ${plan.plan.totals.kcal.toLocaleString("en-IN")} kcal`}</Text>
              <Pressable onPress={() => setAdjusting((v) => !v)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Adjust plan options" accessibilityState={{ expanded: adjusting }}>
                <SymbolView name={{ ios: "slider.horizontal.3", android: "tune", web: "tune" }} size={22} tintColor={colors.forestInk} />
              </Pressable>
            </View>
          )}
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 16 }} showsVerticalScrollIndicator={false} refreshControl={refreshControl}>
          {!plan && !error && (
            <View className="items-center py-16">
              <ActivityIndicator color={colors.primary} />
            </View>
          )}

          {error && (
            <View className="coach__card items-center">
              <Text className="coach__option-title text-center">{"Couldn't load your meal plan"}</Text>
              <Text className="coach__lead text-center">{error}</Text>
              <Pressable onPress={load} className="coach__ghost self-stretch" accessibilityRole="button">
                <Text className="coach__ghost-label">Try again</Text>
              </Pressable>
            </View>
          )}

          {plan && plan.state !== "ready" && (
            <View className="coach__card">
              <Text className="coach__section">No plan yet</Text>
              <Text className="coach__option-note">{`${coach?.name.replace("Coach ", "") ?? "Your coach"} will build a day of Indian meals on your targets.`}</Text>
              {making && <Text className="coach__hint">Building your plan. This can take up to a minute.</Text>}
              <CoachButton label="Make my plan" onPress={regenerate} loading={making} />
            </View>
          )}

          {plan?.plan && (
            <>
              <PlanTimeline plan={plan.plan} logging={logging} onLog={logMeal} swapping={swapping} onSwap={swapMeal} />

              <View className="coach__banner">
                <SymbolView name={{ ios: "doc.text", android: "description", web: "description" }} size={26} tintColor={colors.primary} />
                <View className="min-w-0 flex-1">
                  <Text className="coach__banner-title">Need to make changes?</Text>
                  <Text className="coach__banner-text">Edit your meal plan or regenerate with AI Coach</Text>
                </View>
                <Pressable onPress={() => setAdjusting((v) => !v)} className="coach__banner-btn" accessibilityRole="button" accessibilityLabel="Adjust plan" accessibilityState={{ expanded: adjusting }}>
                  <Text className="coach__banner-btn-label">Adjust Plan</Text>
                  <SymbolView name={adjusting ? { ios: "chevron.down", android: "expand_more", web: "expand_more" } : { ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.primaryText} />
                </Pressable>
              </View>

              {adjusting && (
                <View className="coach__card" style={{ gap: 0 }}>
                  <Pressable onPress={() => { setAdjusting(false); askCoach(); }} className="list-row" accessibilityRole="button" accessibilityLabel="Ask my coach to adjust a meal">
                    <SymbolView name={{ ios: "bubble.left.fill", android: "chat", web: "chat" }} size={18} tintColor={colors.primary} />
                    <Text className="list-row__label">Ask my coach to adjust a meal</Text>
                  </Pressable>
                  <Pressable onPress={() => { setAdjusting(false); regenerate(); }} disabled={making} className="list-row" accessibilityRole="button" accessibilityLabel="Regenerate the plan with AI Coach">
                    <SymbolView name={{ ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }} size={18} tintColor={colors.primary} />
                    <Text className="list-row__label">{making ? "Regenerating…" : "Regenerate with AI Coach"}</Text>
                  </Pressable>
                  <Pressable onPress={() => { setAdjusting(false); editAnswers(); }} className="list-row border-b-0" accessibilityRole="button" accessibilityLabel="Edit my answers to change the plan">
                    <SymbolView name={{ ios: "pencil", android: "edit", web: "edit" }} size={18} tintColor={colors.primary} />
                    <Text className="list-row__label">Edit my answers</Text>
                  </Pressable>
                </View>
              )}

              {making && !adjusting && (
                <View className="flex-row items-center justify-center" style={{ gap: 8 }}>
                  <ActivityIndicator color={colors.primary} />
                  <Text className="coach__hint">Regenerating your plan. This can take up to a minute.</Text>
                </View>
              )}
            </>
          )}

          {actionError && <Text className="macro__error" accessibilityRole="alert">{actionError}</Text>}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
