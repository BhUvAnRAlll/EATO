import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect } from "expo-router";

import { CoachButton } from "@/components/coach/CoachButton";
import { PlanMeals } from "@/components/coach/PlanMeals";
import { coaches, coachGoals, coachStyles, conditions, joints, labelOf, sessionLengths, spots, weekdayChoices } from "@/data/coach";
import { coachApi, type Intake, type IntakePrefill, type PlanState } from "@/lib/coach";
import { todayIso } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { useCoachIntakeStore } from "@/store/coachIntake";
import type { Icon } from "@/types/profile";
import { colors } from "@/theme";

// What the coach will do, shown before the intake
const promises: { icon: Icon; title: string; text: string }[] = [
  { icon: { ios: "fork.knife", android: "restaurant", web: "restaurant" }, title: "A diet plan made for you", text: "Indian meals and easy recipes that hit your targets." },
  { icon: { ios: "dumbbell", android: "fitness_center", web: "fitness_center" }, title: "Training that fits", text: "Your days, your spot, your equipment." },
  { icon: { ios: "bell", android: "notifications", web: "notifications" }, title: "Daily follow-ups", text: "One nudge a day based on what you logged." },
  { icon: { ios: "chart.line.uptrend.xyaxis", android: "trending_up", web: "trending_up" }, title: "Weekly check-ins", text: "Your progress, and what to change next." },
];

const OFFLINE = "Could not reach justFit. Check your connection and try again.";

// The AI Coach tab, in the coach's own look (pink wash, red label over a large title, soft
// cards, the red arrow button): an intro and Get started before the intake; then your coach,
// your plan (Make my plan, then today's meals to log and the workout week) and a summary of
// your answers (with Edit). Reads the intake and the plan each time it comes into view.
export default function Coach() {
  const getToken = useSessionToken();
  const start = useCoachIntakeStore((state) => state.start);
  const [loaded, setLoaded] = useState<{ intake: Intake | null; prefill: IntakePrefill } | null>(null);
  const [plan, setPlan] = useState<PlanState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [logging, setLogging] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const token = await getToken().catch(() => null);
    const result = await coachApi.intake(token);
    if (!result.ok) return setError(result.status ? result.error : OFFLINE);
    if (result.data.intake) {
      const planResult = await coachApi.plan(token, todayIso());
      if (!planResult.ok) return setError(planResult.status ? planResult.error : OFFLINE);
      setPlan(planResult.data);
    }
    setLoaded(result.data);
  }, [getToken]);

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
    const result = await coachApi.makePlan(await getToken().catch(() => null), todayIso());
    setMaking(false);
    if (result.ok) setPlan(result.data);
    else setPlanError(result.status ? result.error : OFFLINE);
  };

  const logMeal = async (mealId: string) => {
    if (logging) return;
    setPlanError(null);
    setLogging(mealId);
    const result = await coachApi.logMeal(await getToken().catch(() => null), mealId, todayIso());
    setLogging(null);
    if (!result.ok) return setPlanError(result.status ? result.error : OFFLINE);
    setPlan((current) =>
      current?.plan ? { ...current, plan: { ...current.plan, meals: current.plan.meals.map((m) => (m.id === mealId ? { ...m, logged: true } : m)) } } : current,
    );
  };

  const intake = loaded?.intake ?? null;
  const coach = coaches.find((c) => c.id === intake?.coach);
  const firstName = coach?.name.replace("Coach ", "") ?? "Your coach";

  return (
    <View className="coach__page">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 120, gap: 16 }} showsVerticalScrollIndicator={false}>
          <View>
            <Text className="coach__eyebrow">AI Coach</Text>
            {loaded && (
              <Text className="coach__title mt-1.5" accessibilityRole="header">{intake ? "Your coach and plan" : "Meet your AI coach"}</Text>
            )}
            {loaded && !intake && <Text className="coach__lead mt-2">Answer a few questions (about 2 minutes) and your coach gets to know you.</Text>}
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
                  <View key={c.id} className="coach__avatar">
                    <Text className="coach__avatar-label">{c.name.replace("Coach ", "").charAt(0)}</Text>
                  </View>
                ))}
              </View>
              <CoachButton label="Get started" onPress={begin} />
            </>
          )}

          {intake && coach && (
            <>
              <View className="coach__card flex-row items-center">
                <View className="coach__avatar">
                  <Text className="coach__avatar-label">{coach.name.replace("Coach ", "").charAt(0)}</Text>
                </View>
                <View className="flex-1 gap-1">
                  <Text className="coach__option-title">{coach.name}</Text>
                  <View className="coach__tag">
                    <Text className="coach__tag-label">{labelOf(coachStyles, intake.coachStyle)}</Text>
                  </View>
                </View>
              </View>

              {plan?.state === "none" && (
                <View className="coach__card">
                  <Text className="coach__section">Your plan</Text>
                  <Text className="coach__lead">{`${firstName} will build a day of Indian meals on your calorie and protein targets, and a workout week for your days, spot and equipment.`}</Text>
                  {making && <Text className="coach__hint">{`${firstName} is building your plan. This can take up to a minute.`}</Text>}
                  <CoachButton label="Make my plan" onPress={makePlan} loading={making} />
                </View>
              )}

              {plan?.state === "ready" && plan.plan && (
                <>
                  <View className="coach__card flex-row items-start">
                    <View className="coach__avatar">
                      <Text className="coach__avatar-label">{firstName.charAt(0)}</Text>
                    </View>
                    <Text className="coach__lead flex-1">{plan.plan.message}</Text>
                  </View>

                  <PlanMeals plan={plan.plan} logging={logging} onLog={logMeal} />

                  {plan.workout && (
                    <View className="coach__card">
                      <View className="flex-row items-end justify-between gap-3">
                        <Text className="coach__section">Your workout week</Text>
                        <Text className="coach__hint">{`${plan.workout.daysPerWeek} days · ${plan.workout.level.charAt(0).toUpperCase()}${plan.workout.level.slice(1)}`}</Text>
                      </View>
                      {plan.workout.sessions.map((session) => (
                        <View key={session.weekday} className="flex-row justify-between gap-4">
                          <Text className="coach__hint">{labelOf(weekdayChoices, session.weekday)}</Text>
                          <Text className="coach__row-value flex-1 text-right">{`${session.title} · ${session.minutes} min`}</Text>
                        </View>
                      ))}
                      <Pressable onPress={() => router.push("/workout")} className="coach__ghost" accessibilityRole="button">
                        <Text className="coach__ghost-label">Open my workouts</Text>
                      </Pressable>
                    </View>
                  )}

                  <View className="setup__note">
                    <SymbolView name={{ ios: "exclamationmark.triangle", android: "warning", web: "warning" }} size={20} tintColor={colors.warning} />
                    <Text className="setup__note-text flex-1 self-center">Fitness guidance, not medical advice. Check every food against your allergies.</Text>
                  </View>
                </>
              )}

              {planError && <Text className="macro__error" accessibilityRole="alert">{planError}</Text>}

              <View className="coach__card">
                <Text className="coach__section">Your answers</Text>
                {[
                  ["Goal", labelOf(coachGoals, intake.goal)],
                  ["Training", `${weekdayChoices.filter((d) => intake.weekdays.includes(d.id)).map((d) => d.label).join(", ")} · ${labelOf(sessionLengths, intake.sessionMinutes)}`],
                  ["Where", intake.backupSpot ? `${labelOf(spots, intake.mainSpot)} · backup ${labelOf(spots, intake.backupSpot)}` : labelOf(spots, intake.mainSpot)],
                  ["Work around", [...intake.joints.map((j) => labelOf(joints, j)), ...intake.conditions.map((c) => labelOf(conditions, c))].join(", ") || "Nothing"],
                ].map(([label, value]) => (
                  <View key={label} className="flex-row justify-between gap-4">
                    <Text className="coach__hint">{label}</Text>
                    <Text className="coach__row-value flex-1 text-right">{value}</Text>
                  </View>
                ))}
              </View>

              {plan?.state === "ready" && (
                <Pressable onPress={makePlan} disabled={making} className="coach__ghost" accessibilityRole="button">
                  {making ? <ActivityIndicator color={colors.primary} /> : <Text className="coach__ghost-label">Make a new plan</Text>}
                </Pressable>
              )}
              <Pressable onPress={begin} className="coach__ghost" accessibilityRole="button">
                <Text className="coach__ghost-label">Edit my answers</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
