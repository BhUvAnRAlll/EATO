import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router } from "expo-router";

import { DashedBlock } from "@/components/macro/DashedBlock";
import { PACES, label } from "@/data/recreate";
import { addDays, dateOf, todayIso } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { GOAL_LABEL, LEVEL_LABEL, SPLIT_LABEL, formatSeconds, shortDay, workoutApi, type PlanOverview } from "@/lib/workoutApi";
import { useThemeColors } from "@/theme";
import { fonts } from "@/constants/fonts";

// Rebuild my plan: "Your plan is ready". Everything here is read back from what was saved,
// not from the draft. There is no back or close: the way out is the footer, which leaves the
// whole flow first so the member lands on the Fitness tab, not inside a modal.

const JOURNEY = [
  ["Build your foundation", "Learn the movements and settle into your week"],
  ["Progress & get stronger", "Training load rises when your logged performance qualifies"],
  ["Reach your goal", "Keep showing up; the plan grows with you"],
];

// The next date (today included) that falls on a weekday
const nextDateOn = (weekday: number, today: string) => {
  for (let i = 0; i < 7; i++) {
    const iso = addDays(today, i);
    if (dateOf(iso).getDay() === weekday) return iso;
  }
  return today;
};

export default function RecreateReveal() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const getToken = useSessionToken();
  const today = todayIso();
  const [load, setLoad] = useState<{ state: "loading" } | { state: "failed"; error: string } | { state: "ready"; plan: PlanOverview }>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await workoutApi.planOverview(await getToken().catch(() => null));
      if (cancelled) return;
      setLoad(result.ok ? { state: "ready", plan: result.data } : { state: "failed", error: result.error });
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, attempt]);

  // Out of the flow onto the Fitness tab, then (optionally) the first session's day
  const leaveTo = (date?: string) => {
    router.dismissTo("/workout");
    if (date) setTimeout(() => router.push({ pathname: "/workout/day", params: { date } }), 0);
  };
  const toPreferences = () => router.dismissTo("/workout/preferences");

  if (load.state !== "ready") {
    return (
      <View className="flex-1 bg-cream px-5" style={{ paddingTop: insets.top + 24 }}>
        {load.state === "loading" ? (
          <ActivityIndicator color={colors.leaf} />
        ) : (
          <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load your plan" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={() => { setLoad({ state: "loading" }); setAttempt((n) => n + 1); }} />
        )}
      </View>
    );
  }

  const { plan } = load;
  const sessions = plan.sessions.map((s) => ({ ...s, date: nextDateOn(s.weekday, today) })).sort((a, b) => (a.date < b.date ? -1 : 1));
  const firstDate = sessions[0]?.date;
  const rows: [string, string][] = [
    ["Goal", GOAL_LABEL[plan.goal]],
    ["Fitness level", LEVEL_LABEL[plan.level]],
    ["Training days", plan.sessions.map((s) => shortDay(s.weekday)).join(", ")],
    ["Pace", label(PACES, plan.pace)],
    ["Workout split", SPLIT_LABEL[plan.split]],
  ];

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ paddingBottom: 24, gap: 18 }} showsVerticalScrollIndicator={false}>
        {/* Hero: the plan's facts on the dark surface (sessions have no photos yet) */}
        <View className="bg-immersive" style={{ paddingTop: insets.top + 32, paddingHorizontal: 20, paddingBottom: 28, gap: 10 }}>
          <Text className="type-overline" style={{ color: colors.leaf }}>Your new plan</Text>
          <Text className="text-white" style={{ fontSize: 30, lineHeight: 36, fontFamily: fonts.semibold }}>Your plan is ready</Text>
          <Text style={{ color: colors.white, opacity: 0.8 }}>Your workout plan has been built around your goal, fitness level and schedule.</Text>
          <View className="mt-1 flex-row flex-wrap gap-2">
            {[GOAL_LABEL[plan.goal], LEVEL_LABEL[plan.level], `${plan.daysPerWeek} days / week`].map((pill) => (
              <View key={pill} className="workout__chip">
                <Text className="workout__chip-label">{pill}</Text>
              </View>
            ))}
          </View>
        </View>

        <View className="gap-4 px-5">
          <View className="home__card gap-1" style={{ paddingVertical: 12 }}>
            <View className="flex-row items-center justify-between pb-1">
              <Text className="setup__section">Built for you</Text>
              <Pressable onPress={toPreferences} hitSlop={8} accessibilityRole="button" accessibilityLabel="Edit preferences">
                <Text className="home__link">Edit</Text>
              </Pressable>
            </View>
            {rows.map(([name, value]) => (
              <Pressable key={name} onPress={toPreferences} className="flex-row items-center justify-between py-1.5" accessibilityRole="button" accessibilityLabel={`${name}: ${value}`}>
                <Text className="meta-text">{name}</Text>
                <Text className="card__title">{value}</Text>
              </Pressable>
            ))}
          </View>

          {plan.requiresProfessionalReview && (
            <View className="workout-safety" accessibilityRole="alert">
              <SymbolView name={{ ios: "exclamationmark.shield.fill", android: "health_and_safety", web: "health_and_safety" }} size={18} tintColor={colors.warning} />
              <Text className="workout-safety__text">
                This plan uses beginner-level exercise selections and excludes high-risk movements. Please review your plan with a qualified healthcare professional or qualified trainer before exercising.
              </Text>
            </View>
          )}

          <View className="gap-2.5">
            <Text className="setup__section">Your workout journey</Text>
            {JOURNEY.map(([title, text], i) => (
              <View key={title} className="flex-row items-start gap-3">
                <View className="recreate__node recreate__node--active"><Text className="recreate__node-label recreate__node-label--active">{i + 1}</Text></View>
                <View className="min-w-0 flex-1">
                  <Text className="card__title">{title}</Text>
                  <Text className="meta-text">{text}</Text>
                </View>
              </View>
            ))}
          </View>

          <View className="gap-2.5">
            <Text className="setup__section">This week</Text>
            {sessions.map((s) => {
              const isToday = s.date === today;
              return (
                <View key={s.dayId} className="home__card flex-row items-center gap-3" accessibilityLabel={`${shortDay(s.weekday)}${isToday ? " (today)" : ""}: ${s.title}, ${s.minutes} min, ${s.exerciseCount} exercises`}>
                  <View className={isToday ? "recreate__day recreate__day--today" : "recreate__day"}>
                    <Text className="type-caption" style={{ color: isToday ? colors.white : colors.forestInk, fontFamily: fonts.semibold }}>{shortDay(s.weekday)}</Text>
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="card__title" numberOfLines={1}>{s.title}</Text>
                    <Text className="meta-text">{`${s.minutes} min · ${s.exerciseCount} exercises`}</Text>
                  </View>
                </View>
              );
            })}
          </View>

          {plan.firstSession && (
            <View className="gap-2.5">
              <Text className="setup__section">Your first workout</Text>
              <View className="home__card" style={{ paddingVertical: 4 }}>
                {plan.firstSession.exercises.map((e, i, all) => {
                  const timed = e.sets[0]?.durationSec !== undefined;
                  const prescription = timed
                    ? `${e.sets.length} × ${formatSeconds(e.sets[0]?.durationSec ?? 0)}`
                    : `${e.sets.length} × ${e.repsMin ?? e.sets[0]?.reps ?? 0}–${e.repsMax ?? e.sets[0]?.reps ?? 0} reps`;
                  return (
                    <View key={e.id} className="flex-row items-center justify-between gap-3 py-3" style={i < all.length - 1 ? { borderBottomWidth: 1, borderColor: colors.creamLine } : undefined}>
                      <Text className="card__title min-w-0 flex-1" numberOfLines={2}>{e.name}</Text>
                      <View className="items-end">
                        <Text className="type-subhead text-forest-ink">{prescription}</Text>
                        {e.restSec > 0 && <Text className="meta-text">{`Rest ${formatSeconds(e.restSec)}`}</Text>}
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      <View className="gap-2 border-t border-cream-line px-5 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 12) + 4 }}>
        <Pressable onPress={() => leaveTo(firstDate)} className="btn-forest" accessibilityRole="button" accessibilityLabel="View my workout">
          <Text className="btn-forest__label">View my workout</Text>
        </Pressable>
        <Pressable onPress={() => leaveTo()} className="btn-outline" accessibilityRole="button" accessibilityLabel="View plan details">
          <Text className="btn-outline__label">View plan details</Text>
        </Pressable>
      </View>
    </View>
  );
}
