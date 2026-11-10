import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View, type ScrollViewInstance } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect } from "expo-router";

import { SymbolView } from "@/components/SymbolView";
import { CoachButton } from "@/components/coach/CoachButton";
import { MealRemindersRow } from "@/components/coach/MealRemindersRow";
import { PlanTimeline } from "@/components/coach/PlanTimeline";
import { RecommendedMeals } from "@/components/meals/RecommendedMeals";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { ScreenSkeleton } from "@/components/Skeleton";
import { coaches } from "@/data/coach";
import { track } from "@/lib/analytics";
import { haptic } from "@/lib/haptics";
import { syncMealReminders } from "@/lib/mealReminders";
import { coachApi, type Intake, type IntakePrefill, type IntakeProfile, type PlanState } from "@/lib/coach";
import type { Gender } from "@/types/profile";
import { todayIso } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { useCoachIntakeStore } from "@/store/coachIntake";
import { matchMeals, planReason } from "@/lib/mealMatch";
import type { MenuMeal } from "@/lib/mealsApi";
import { useMyFood } from "@/store/myFood";
import { useStorefront } from "@/store/storefront";
import { useThemeColors } from "@/theme";
import { confirmChoice } from "@/lib/nativeSheets";

// The plan's meal times justFit delivers (the others get no Order from justFit)
const ORDERABLE: Partial<Record<string, string>> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
const OFFLINE = "Could not reach justFit. Check your connection and try again.";

const back = () => (router.canGoBack() ? router.back() : router.replace("/coach"));

// The coach's Meal Plan for today, on its own: the five meals down a timeline (time, slot, dish,
// ingredients, calories, macros, Swap, Log Meal), with "N Meals · kcal" in the header and the
// Adjust Plan banner at the bottom (ask the coach to adjust a meal, regenerate with AI Coach, or
// edit the answers). Swap opens the Swap Meal screen, where the coach offers three dishes made for
// the member and the day, instead of remaking the whole day. The workout is not here: it has its
// own card on the Coach tab.
export default function MealPlanScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const getToken = useSessionToken();
  const start = useCoachIntakeStore((state) => state.start);
  const [loaded, setLoaded] = useState<{ intake: Intake | null; prefill: IntakePrefill; profile?: Partial<IntakeProfile>; gender?: Gender | null } | null>(null);
  const [plan, setPlan] = useState<PlanState | null>(null);
  // The plan as it is now, for a save that lands after a reload (updaters stay pure)
  const planRef = useRef<PlanState | null>(null);
  useEffect(() => {
    planRef.current = plan;
  }, [plan]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [logging, setLogging] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  // The page scrolls down to the Adjust Plan options when they open (they sit under the banner at the bottom)
  const scroll = useRef<ScrollViewInstance>(null);
  // Only the newest read's answer is shown (a pull during the focus read never puts an older answer over a newer one)
  const latest = useRef(0);

  // Order from justFit (2026-11-10): under each breakfast, lunch and dinner still to eat, the menu
  // meal closest to it, never against the member's diet or allergies (lib/mealMatch.ts, on the
  // phone: no AI, no cost); each meal time gets a different one
  const menu = useStorefront((state) => state.load);
  const readMenu = useStorefront((state) => state.read);
  const food = useMyFood((state) => state.food);
  const foodRead = useMyFood((state) => state.read);
  const loadFood = useMyFood((state) => state.load);
  const orderPicks = useMemo(() => {
    const picks = new Map<string, { meal: MenuMeal; note: string }>();
    if (!plan?.plan || menu.state !== "ready" || !foodRead) return picks;
    const used: string[] = [];
    for (const meal of plan.plan.meals) {
      const label = ORDERABLE[meal.slot];
      if (meal.logged || !label) continue;
      const [best] = matchMeals(menu.data.meals, food, { kcal: meal.totals.kcal, proteinG: meal.totals.proteinG }, { max: 1, exclude: used });
      if (!best) continue;
      used.push(best.meal.id);
      picks.set(meal.id, { meal: best.meal, note: planReason(best, label) });
    }
    return picks;
  }, [plan, menu, food, foodRead]);

  const load = useCallback(async () => {
    const request = ++latest.current;
    setError(null);
    const token = await getToken().catch(() => null);
    readMenu(token);
    loadFood(token);
    const [intake, planResult] = await Promise.all([coachApi.intake(token), coachApi.plan(token, todayIso())]);
    if (request !== latest.current) return;
    if (!intake.ok) return setError(intake.status ? intake.error : OFFLINE);
    if (!planResult.ok) return setError(planResult.status ? planResult.error : OFFLINE);
    setLoaded(intake.data);
    setPlan(planResult.data);
    syncMealReminders(planResult.data.plan, todayIso()).catch(() => {});
  }, [getToken, readMenu, loadFood]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // A pull reads the intake and today's plan again
  const { refreshControl } = usePullToRefresh(load);

  const logMeal = async (mealId: string) => {
    // Not while the plan is being remade: the meal may not be in the new plan
    if (logging || making) return;
    setActionError(null);
    setLogging(mealId);
    const result = await coachApi.logMeal(await getToken().catch(() => null), mealId, todayIso());
    setLogging(null);
    if (!result.ok) {
      haptic.error();
      return setActionError(result.status ? result.error : OFFLINE);
    }
    haptic.success();
    // Marked on the plan as it is now (not as it was when the tap came), so a reload or a swap
    // that landed meanwhile is kept; the logged meal's reminder is dropped (the others stay)
    const current = planRef.current;
    const next = current?.plan ? { ...current, plan: { ...current.plan, meals: current.plan.meals.map((m) => (m.id === mealId ? { ...m, logged: true } : m)) } } : current;
    setPlan(next);
    syncMealReminders(next?.plan ?? null, todayIso()).catch(() => {});
  };

  // The Swap Meal screen does the swap; this screen reads the plan again when it comes back into view
  const swapMeal = (mealId: string) => {
    if (making) return;
    router.push({ pathname: "/coach/swap-meal", params: { mealId } });
  };

  const regenerate = async () => {
    if (making) return;
    setActionError(null);
    setMaking(true);
    const result = await coachApi.makePlan(await getToken().catch(() => null), todayIso());
    if (result.ok) track("coach_plan_made");
    setMaking(false);
    if (!result.ok) return setActionError(result.status ? result.error : OFFLINE);
    setPlan(result.data);
    syncMealReminders(result.data.plan, todayIso()).catch(() => {});
  };

  // Remaking a plan is a paid AI call that replaces every meal, so it asks first
  const confirmRegenerate = () => {
    if (making) return;
    const question = "Regenerate your meal plan?";
    const detail = "Your coach writes a new day of meals; today's plan is replaced.";
    confirmChoice({ title: question, message: detail, confirmLabel: "Regenerate", destructive: false }).then((ok) => {
      if (ok) regenerate();
    });
  };

  const editAnswers = () => {
    if (!loaded) return;
    start(loaded.intake, loaded.prefill, loaded.profile, loaded.gender);
    router.push("/coach/intake/goal");
  };

  const coach = coaches.find((c) => c.id === loaded?.intake?.coach);
  const askCoach = () => router.push({ pathname: "/coach/chat", params: { name: coach?.name ?? "Your coach", ...(coach ? { coach: coach.id } : {}), q: "Adjust my diet" } });
  const meals = plan?.plan?.meals ?? [];

  return (
    <View className="coach__page">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View className="min-h-14 flex-row items-center px-4" style={{ gap: 12 }}>
          <Pressable onPress={back} className="coach__circle-btn" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "arrow.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
          </Pressable>
          {/* The count sits under the title: beside it, the title was cut to "Meal …" on a 360-wide
              phone at its larger text (2026-11-08) */}
          <View className="min-w-0 flex-1">
            <Text className="coach__title" style={{ fontSize: 24, lineHeight: 30 }} accessibilityRole="header" numberOfLines={1}>Meal Plan</Text>
            {plan?.plan && <Text className="coach__hint" numberOfLines={1}>{`${meals.length} Meals · ${plan.plan.totals.kcal.toLocaleString("en-IN")} kcal`}</Text>}
          </View>
          {plan?.plan && (
            <View className="flex-row items-center">
              <Pressable onPress={() => setAdjusting((v) => !v)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Adjust plan options" accessibilityState={{ expanded: adjusting }}>
                <SymbolView name={{ ios: "slider.horizontal.3", android: "tune", web: "tune" }} size={22} tintColor={colors.forestInk} />
              </Pressable>
            </View>
          )}
        </View>

        <ScrollView ref={scroll} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 + insets.bottom, gap: 16 }} showsVerticalScrollIndicator={false} refreshControl={refreshControl}>
          {!plan && !error && <ScreenSkeleton cards={3} label="Loading your meal plan" />}

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
              <PlanTimeline
                plan={plan.plan}
                logging={logging}
                onLog={logMeal}
                onSwap={swapMeal}
                busy={making}
                below={(meal) => {
                  const pick = orderPicks.get(meal.id);
                  return pick ? (
                    <View style={{ gap: 8, marginTop: -6 }}>
                      <Text className="coach__hint">{`Or order your ${ORDERABLE[meal.slot]?.toLowerCase()} from justFit`}</Text>
                      <RecommendedMeals items={[pick]} />
                    </View>
                  ) : null;
                }}
              />

              <MealRemindersRow plan={plan.plan} date={todayIso()} />

              <View className="coach__banner">
                <SymbolView name={{ ios: "doc.text", android: "description", web: "description" }} size={26} tintColor={colors.leaf} />
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
                <View className="coach__card" style={{ gap: 0 }} onLayout={() => scroll.current?.scrollToEnd({ animated: true })}>
                  <Pressable onPress={() => { setAdjusting(false); askCoach(); }} className="list-row" accessibilityRole="button" accessibilityLabel="Ask my coach to adjust a meal">
                    <SymbolView name={{ ios: "bubble.left.fill", android: "chat", web: "chat" }} size={18} tintColor={colors.leaf} />
                    <Text className="list-row__label">Ask my coach to adjust a meal</Text>
                  </Pressable>
                  <Pressable onPress={() => { setAdjusting(false); confirmRegenerate(); }} disabled={making} className="list-row" accessibilityRole="button" accessibilityLabel="Regenerate the plan with AI Coach">
                    <SymbolView name={{ ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }} size={18} tintColor={colors.leaf} />
                    <Text className="list-row__label">{making ? "Regenerating…" : "Regenerate with AI Coach"}</Text>
                  </Pressable>
                  <Pressable onPress={() => { setAdjusting(false); editAnswers(); }} className="list-row border-b-0" accessibilityRole="button" accessibilityLabel="Edit my answers to change the plan">
                    <SymbolView name={{ ios: "pencil", android: "edit", web: "edit" }} size={18} tintColor={colors.leaf} />
                    <Text className="list-row__label">Edit my answers</Text>
                  </Pressable>
                </View>
              )}

              {making && !adjusting && (
                <View className="flex-row items-center justify-center" style={{ gap: 8 }}>
                  <ActivityIndicator color={colors.leaf} />
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
