import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect } from "expo-router";

import { ChangeCoachSheet } from "@/components/coach/ChangeCoachSheet";
import { CoachAvatar } from "@/components/coach/CoachAvatar";
import { CoachButton } from "@/components/coach/CoachButton";
import type { TodayWorkout } from "@/components/coach/PlanTimeline";
import { TodayOverview } from "@/components/coach/TodayOverview";
import { coachPrompts, coaches, coachStyles, labelOf, weekdayChoices, type CoachId, type CoachStyle } from "@/data/coach";
import { coachApi, type Intake, type IntakePrefill, type PlanState } from "@/lib/coach";
import { macro, todayIso, type DayView } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { LEVEL_LABEL, weekOf, workoutApi } from "@/lib/workoutApi";
import { useCoachChatStore } from "@/store/coachChat";
import { useCoachIntakeStore } from "@/store/coachIntake";
import type { Icon } from "@/types/profile";
import { colors } from "@/theme";
import { track } from "@/lib/analytics";

// What the coach will do, shown before the intake
const promises: { icon: Icon; title: string; text: string }[] = [
  { icon: { ios: "fork.knife", android: "restaurant", web: "restaurant" }, title: "Customized Diet Plan", text: "Indian meals and easy recipes that hit your targets." },
  { icon: { ios: "play.circle.fill", android: "play_circle", web: "play_circle" }, title: "Live Workout Sessions", text: "Train step by step, for your days and equipment." },
  { icon: { ios: "bell", android: "notifications", web: "notifications" }, title: "Daily Follow-Ups", text: "A nudge each day based on what you logged." },
  { icon: { ios: "chart.line.uptrend.xyaxis", android: "trending_up", web: "trending_up" }, title: "Weekly Progress Check-ins", text: "Your progress, and what to change next." },
  { icon: { ios: "bubble.left.and.bubble.right", android: "forum", web: "forum" }, title: "Problem Solving & Guidance Anytime", text: "Ask your coach about food, training or progress, any time." },
];

type PlanTab = "today" | "week" | "insights";
const planTabs: { id: PlanTab; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "insights", label: "Insights" },
];

const OFFLINE = "Could not reach justFit. Check your connection and try again.";

// The workout row's one line, as the Workout screen's hero puts it: "Legs · 7 exercises · 61 min ·
// Continue", or the rest day
function workoutNote({ day, status, plan }: TodayWorkout) {
  if (!day) return "Rest day · Recover well";
  const action = status === "completed" ? "Done" : status === "in_progress" ? "Continue" : "Start";
  return `${day.title} · ${day.exerciseCount} exercises · ${day.minutes} min · ${LEVEL_LABEL[plan.level]} · ${action}`;
}

// The AI Coach tab, in the coach's own look (pink wash, white cards, red accents). Before the
// intake: what the coach does and Get started. After it, each thing once, top to bottom: your
// coach (Change, and the ask box that opens the chat), today's numbers from Macro, the plan
// (Today's meals and workout on a timeline, the Week, Insights), then Edit my answers and Make
// a new plan. Reads everything each time it comes into view.
export default function Coach() {
  const getToken = useSessionToken();
  const start = useCoachIntakeStore((state) => state.start);
  const clearChat = useCoachChatStore((state) => state.clear);
  const [loaded, setLoaded] = useState<{ intake: Intake | null; prefill: IntakePrefill } | null>(null);
  const [plan, setPlan] = useState<PlanState | null>(null);
  const [day, setDay] = useState<DayView | null>(null);
  const [workout, setWorkout] = useState<TodayWorkout | null>(null);
  const [tab, setTab] = useState<PlanTab>("today");
  const [error, setError] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [savingCoach, setSavingCoach] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);

  // Today's workout; a failure here only hides the workout row, never the tab
  const loadWorkout = useCallback(async (token: string | null, today: string) => {
    const home = await workoutApi.home(token, today, weekOf(today), today);
    if (!home.ok || home.data.plan === null) return setWorkout(null);
    setWorkout({ plan: home.data.plan, status: home.data.status, day: home.data.day, week: home.data.week });
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const token = await getToken().catch(() => null);
    const today = todayIso();
    const result = await coachApi.intake(token);
    if (!result.ok) return setError(result.status ? result.error : OFFLINE);
    if (result.data.intake) {
      const [planResult, dayResult] = await Promise.all([coachApi.plan(token, today), macro.day(token, today), loadWorkout(token, today)]);
      if (!planResult.ok) return setError(planResult.status ? planResult.error : OFFLINE);
      setPlan(planResult.data);
      setDay(dayResult.ok ? dayResult.data : null);
    }
    setLoaded(result.data);
  }, [getToken, loadWorkout]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const begin = () => {
    if (!loaded) return;
    start(loaded.intake, loaded.prefill);
    router.push("/coach/intake/goal");
  };

  const makePlan = async () => {
    if (making) return;
    setPlanError(null);
    setMaking(true);
    const token = await getToken().catch(() => null);
    const result = await coachApi.makePlan(token, todayIso());
    if (result.ok) track("coach_plan_made");
    setMaking(false);
    if (!result.ok) return setPlanError(result.status ? result.error : OFFLINE);
    setPlan(result.data);
    loadWorkout(token, todayIso());
  };

  // A new coach starts a new conversation: the old chat was with someone else
  const saveCoach = async (coach: CoachId, coachStyle: CoachStyle) => {
    if (savingCoach) return;
    setCoachError(null);
    setSavingCoach(true);
    const result = await coachApi.changeCoach(await getToken().catch(() => null), coach, coachStyle);
    setSavingCoach(false);
    if (!result.ok) return setCoachError(result.status ? result.error : OFFLINE);
    if (result.data.intake.coach !== loaded?.intake?.coach) clearChat();
    setLoaded((current) => (current ? { ...current, intake: result.data.intake } : current));
    setChanging(false);
  };

  const intake = loaded?.intake ?? null;
  const coach = coaches.find((c) => c.id === intake?.coach);
  const firstName = coach?.name.replace("Coach ", "") ?? "Your coach";
  const openChat = (q?: string) => router.push({ pathname: "/coach/chat", params: { name: coach?.name ?? "Your coach", ...(coach ? { coach: coach.id } : {}), ...(q ? { q } : {}) } });

  return (
    <View className="coach__page">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 120, gap: 16 }} showsVerticalScrollIndicator={false}>
          {/* Header: one title, the bell at the right */}
          <View className="flex-row items-center justify-between gap-3">
            <Text className="coach__title" accessibilityRole="header">{intake ? "AI Coach" : "Meet your AI coach"}</Text>
            {intake && (
              <Pressable onPress={() => router.push("/community/notifications")} className="coach__circle-btn" accessibilityRole="button" accessibilityLabel="Notifications">
                <SymbolView name={{ ios: "bell", android: "notifications", web: "notifications" }} size={20} tintColor={colors.forestInk} />
              </Pressable>
            )}
          </View>

          {!loaded && !error && (
            <View className="items-center py-16">
              <ActivityIndicator color={colors.primary} />
            </View>
          )}

          {error && (
            <View className="coach__card items-center">
              <Text className="coach__option-title text-center">{"Couldn't load your coach"}</Text>
              <Text className="coach__lead text-center">{error}</Text>
              <Pressable onPress={load} className="coach__ghost self-stretch" accessibilityRole="button">
                <Text className="coach__ghost-label">Try again</Text>
              </Pressable>
            </View>
          )}

          {loaded && !intake && (
            <>
              <Text className="coach__lead -mt-2">Answer a few questions (about 2 minutes) and your coach gets to know you.</Text>
              <View className="coach__card">
                {promises.map((item) => (
                  <View key={item.title} className="flex-row items-center gap-3">
                    <View className="coach__option-icon h-11 w-11">
                      <SymbolView name={item.icon} size={20} tintColor={colors.primary} />
                    </View>
                    <View className="flex-1 gap-0.5">
                      <Text className="coach__option-title">{item.title}</Text>
                      <Text className="coach__option-note">{item.text}</Text>
                    </View>
                  </View>
                ))}
              </View>
              <View className="flex-row justify-center gap-2" accessibilityLabel={`Coaches: ${coaches.map((c) => c.name).join(", ")}`}>
                {coaches.map((c) => (
                  <CoachAvatar key={c.id} coach={c.id} />
                ))}
              </View>
              <CoachButton label="Get started" onPress={begin} />
            </>
          )}

          {intake && coach && (
            <>
              {/* Your coach: who, Change, and the ask box (everything here opens the chat) */}
              <View className="coach__card">
                <View className="flex-row items-center gap-3">
                  <CoachAvatar coach={coach.id} size={56} />
                  <View className="flex-1 gap-0.5">
                    <Text className="coach__option-title">{coach.name}</Text>
                    <Text className="coach__option-note" numberOfLines={1}>{`${coach.note.split(".")[0]} · ${labelOf(coachStyles, intake.coachStyle)}`}</Text>
                  </View>
                  <Pressable onPress={() => setChanging(true)} className="coach__pill" accessibilityRole="button" accessibilityLabel="Change coach">
                    <Text className="coach__pill-label">Change</Text>
                  </Pressable>
                </View>
                <Pressable onPress={() => openChat()} className="coach__ask" accessibilityRole="button" accessibilityLabel={`Ask ${firstName}`}>
                  <SymbolView name={{ ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }} size={18} tintColor={colors.primary} />
                  <Text className="coach__ask-text" numberOfLines={1}>{`Ask ${firstName} anything...`}</Text>
                  <View className="coach__send">
                    <SymbolView name={{ ios: "paperplane.fill", android: "send", web: "send" }} size={17} tintColor={colors.onPrimary} />
                  </View>
                </Pressable>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2, paddingHorizontal: 1 }}>
                  {coachPrompts.map((prompt) => (
                    <Pressable key={prompt} onPress={() => openChat(prompt)} className="coach__prompt" accessibilityRole="button" accessibilityLabel={`Ask: ${prompt}`}>
                      <Text className="coach__prompt-label">{prompt}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              {day && <TodayOverview date={day.date} totals={day.totals} targets={day.targets} />}

              {plan?.state === "none" && (
                <View className="coach__card">
                  <Text className="coach__section">Your plan</Text>
                  <Text className="coach__option-note">{`${firstName} will build a day of Indian meals on your targets, and a workout week for your days, spot and equipment.`}</Text>
                  {making && <Text className="coach__hint">{`${firstName} is building your plan. This can take up to a minute.`}</Text>}
                  <CoachButton label="Make my plan" onPress={makePlan} loading={making} />
                </View>
              )}

              {plan?.state === "ready" && plan.plan && (
                <View className="coach__card">
                  <View className="flex-row items-center justify-between">
                    <Text className="coach__section">Your plan</Text>
                    <Text className="coach__hint">{`${plan.plan.totals.kcal} / ${plan.plan.targets.calories} kcal`}</Text>
                  </View>
                  <View className="coach__tabs" accessibilityRole="tablist">
                    {planTabs.map((t) => {
                      const active = tab === t.id;
                      return (
                        <Pressable key={t.id} onPress={() => setTab(t.id)} className={active ? "coach__tab coach__tab--active" : "coach__tab"} accessibilityRole="tab" aria-selected={active}>
                          <Text className={active ? "coach__tab-label coach__tab-label--active" : "coach__tab-label"}>{t.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {tab === "today" && (
                    <>
                      <Text className="coach__option-note" numberOfLines={3}>{plan.plan.message}</Text>
                      <Pressable
                        onPress={() => router.push("/coach/meal-plan")}
                        className="coach__option"
                        accessibilityRole="button"
                        accessibilityLabel="Open meal plan"
                        accessibilityHint={`${plan.plan.meals.length} meals, ${plan.plan.totals.kcal} kcal, ${plan.plan.meals.filter((m) => m.logged).length} of ${plan.plan.meals.length} logged`}
                      >
                        <View className="coach__option-icon h-11 w-11">
                          <SymbolView name={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }} size={20} tintColor={colors.primary} />
                        </View>
                        <View className="min-w-0 flex-1 gap-0.5">
                          <Text className="coach__option-title">Meal plan</Text>
                          <Text className="coach__option-note" numberOfLines={1}>{`${plan.plan.meals.length} meals · ${plan.plan.totals.kcal.toLocaleString("en-IN")} kcal · ${plan.plan.meals.filter((m) => m.logged).length} of ${plan.plan.meals.length} logged`}</Text>
                        </View>
                        <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
                      </Pressable>
                      {workout && (
                        <Pressable onPress={() => router.push("/workout")} className="coach__option" accessibilityRole="button" accessibilityLabel="Open workout" accessibilityHint={workoutNote(workout)}>
                          <View className="coach__option-icon h-11 w-11">
                            <SymbolView name={{ ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" }} size={20} tintColor={colors.primary} />
                          </View>
                          <View className="min-w-0 flex-1 gap-0.5">
                            <Text className="coach__option-title">Workout</Text>
                            <Text className="coach__option-note" numberOfLines={1}>{workoutNote(workout)}</Text>
                          </View>
                          <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
                        </Pressable>
                      )}
                    </>
                  )}

                  {tab === "week" &&
                    (plan.workout ? (
                      <>
                        {plan.workout.sessions.map((session) => (
                          <View key={session.weekday} className="flex-row justify-between gap-4">
                            <Text className="coach__hint">{labelOf(weekdayChoices, session.weekday)}</Text>
                            <Text className="coach__row-value flex-1 text-right">{`${session.title} · ${session.minutes} min`}</Text>
                          </View>
                        ))}
                        <Pressable onPress={() => router.push("/workout")} className="coach__ghost" accessibilityRole="button">
                          <Text className="coach__ghost-label">Open my workouts</Text>
                        </Pressable>
                      </>
                    ) : (
                      <Text className="coach__hint">Your workout week appears here once your plan has one.</Text>
                    ))}

                  {tab === "insights" && (
                    <View className="items-center gap-2 py-6">
                      <View className="coach__option-icon">
                        <SymbolView name={{ ios: "chart.bar.fill", android: "bar_chart", web: "bar_chart" }} size={22} tintColor={colors.primary} />
                      </View>
                      <Text className="coach__option-title">Insights are coming soon</Text>
                      <Text className="coach__hint text-center">{`${firstName} will show your trends here: meals logged, workouts done and how close you get to your targets.`}</Text>
                    </View>
                  )}
                </View>
              )}

              {planError && <Text className="macro__error" accessibilityRole="alert">{planError}</Text>}

              {/* Changing the plan: a settings-style group */}
              <View className="coach__card gap-0 py-1">
                <Pressable onPress={begin} className="list-row border-b-0" accessibilityRole="button" accessibilityLabel="Edit my answers">
                  <SymbolView name={{ ios: "slider.horizontal.3", android: "tune", web: "tune" }} size={18} tintColor={colors.primary} />
                  <Text className="list-row__label">Edit my answers</Text>
                  <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
                </Pressable>
              </View>

              <Text className="coach__hint text-center">Fitness guidance, not medical advice. Check every food against your allergies.</Text>

              {changing && (
                <ChangeCoachSheet
                  coach={intake.coach}
                  coachStyle={intake.coachStyle}
                  saving={savingCoach}
                  error={coachError}
                  onSave={saveCoach}
                  onClose={() => {
                    setChanging(false);
                    setCoachError(null);
                  }}
                />
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
