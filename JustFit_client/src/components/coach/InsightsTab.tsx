import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";

import { SkeletonBlock, SkeletonPulse } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { changeIsGood, daysBetween, kgChange, shortDay, weekdayLetter, weekRange } from "@/lib/coachInsightsRules";
import {
  insightsApi,
  type CoachReview, type Insights, type InsightsWeek, type MacroStat, type NutritionInsights, type ReviewArea, type WeightInsights, type WorkoutInsights,
} from "@/lib/coachInsights";
import { todayIso } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { MUSCLE_LABEL } from "@/lib/workoutApi";
import type { Icon } from "@/types/profile";
import { useThemeColors } from "@/theme";

type Props = {
  // The coach's first name ("Priya"), for the review card
  coachName: string;
  // What's already been read this visit, by week, so switching tabs doesn't read it again
  cache: Partial<Record<InsightsWeek, Insights>>;
  onLoaded: (week: InsightsWeek, data: Insights) => void;
  // Opens the chat with a question already typed
  onAsk: (question: string) => void;
};

const OFFLINE = "Could not reach justFit. Check your connection and try again.";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const TIP_ICON: Record<ReviewArea, Icon> = {
  nutrition: { ios: "fork.knife", android: "restaurant", web: "restaurant" },
  protein: { ios: "bolt.fill", android: "bolt", web: "bolt" },
  workout: { ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" },
  recovery: { ios: "moon.zzz.fill", android: "bedtime", web: "bedtime" },
  next_week: { ios: "calendar", android: "calendar_today", web: "calendar_today" },
};
const TIP_LABEL: Record<ReviewArea, string> = { nutrition: "Nutrition", protein: "Protein", workout: "Workouts", recovery: "Recovery", next_week: "Next week" };
const GOAL_LABEL = { lose: "Goal: lose weight", gain: "Goal: gain muscle", maintain: "Goal: stay steady" } as const;
// Whole class names, written out: the style build only sees classes spelled in full
const PILL = { ok: "insights__pill", low: "insights__pill insights__pill--low", high: "insights__pill insights__pill--high" } as const;
const PILL_LABEL = { ok: "insights__pill-label", low: "insights__pill-label insights__pill-label--low", high: "insights__pill-label insights__pill-label--high" } as const;
const VERDICT_LABEL = { low: "Low", ok: "On track", high: "High" } as const;

// The Insights tab on the AI Coach's "Your plan" card: the member's week from what they logged
// (food against their targets, workouts done against planned, weight they entered) and their
// coach's review of it. Reading the week is free; the review is written by the AI once a week and
// saved, so it's asked for automatically only when there's none yet. A section with no data is
// left out, never shown as zeros.
export function InsightsTab({ coachName, cache, onLoaded, onAsk }: Props) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [week, setWeek] = useState<InsightsWeek>("this");
  const data = cache[week] ?? null;
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  // Weeks whose review was asked for automatically this visit: never twice, even after an error
  const autoAsked = useRef(new Set<InsightsWeek>());

  const askReview = useCallback(
    async (which: InsightsWeek, refresh = false) => {
      const token = await getToken().catch(() => null);
      setReviewError(null);
      setReviewing(true);
      const result = await insightsApi.review(token, todayIso(), which, refresh);
      setReviewing(false);
      if (!result.ok) return setReviewError(result.status ? result.error : OFFLINE);
      onLoaded(which, result.data);
    },
    [getToken, onLoaded],
  );

  const load = useCallback(
    async (which: InsightsWeek) => {
      const result = await insightsApi.get(await getToken().catch(() => null), todayIso(), which);
      if (!result.ok) return setError(result.status ? result.error : OFFLINE);
      setError(null);
      onLoaded(which, result.data);
    },
    [getToken, onLoaded],
  );

  // Read a week the first time it's shown (the cache is emptied by a pull to refresh)
  const missing = !cache[week];
  useEffect(() => {
    if (!missing) return;
    let active = true;
    (async () => {
      const result = await insightsApi.get(await getToken().catch(() => null), todayIso(), week);
      if (!active) return;
      if (!result.ok) return setError(result.status ? result.error : OFFLINE);
      onLoaded(week, result.data);
    })();
    return () => {
      active = false;
    };
  }, [missing, week, getToken, onLoaded]);

  // No review for the week yet, and something to review: ask the coach once
  useEffect(() => {
    if (!data || data.review || !data.canReview || autoAsked.current.has(week)) return;
    autoAsked.current.add(week);
    askReview(week);
  }, [data, week, askReview]);

  const switcher = (
    <View className="flex-row flex-wrap items-center justify-between gap-2">
      <View className="insights__switch" accessibilityRole="tablist">
        {(["this", "last"] as const).map((w) => {
          const active = w === week;
          return (
            <Pressable
              key={w}
              onPress={() => {
                setError(null);
                setReviewError(null);
                setWeek(w);
              }}
              className={active ? "insights__chip insights__chip--active" : "insights__chip"} accessibilityRole="tab" aria-selected={active}>
              <Text className={active ? "insights__chip-label insights__chip-label--active" : "insights__chip-label"}>{w === "this" ? "This week" : "Last week"}</Text>
            </Pressable>
          );
        })}
      </View>
      {data && <Text className="coach__hint">{weekRange(data.week.start, data.week.end)}</Text>}
    </View>
  );

  if (error && !data) {
    return (
      <View className="gap-3">
        {switcher}
        <View className="insights__card items-center">
          <Text className="insights__title text-center">{"Couldn't load your insights"}</Text>
          <Text className="coach__hint text-center">{error}</Text>
          <Pressable
            onPress={() => {
              setError(null);
              load(week);
            }}
            className="coach__ghost self-stretch"
            accessibilityRole="button"
          >
            <Text className="coach__ghost-label">Try again</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!data) {
    return (
      <View className="gap-3">
        {switcher}
        <SkeletonPulse label="Loading your insights" className="gap-3">
          {[0, 1, 2].map((i) => (
            <View key={i} className="insights__card">
              <SkeletonBlock width="40%" height={14} />
              <SkeletonBlock height={56} />
              <SkeletonBlock width="70%" height={12} />
            </View>
          ))}
        </SkeletonPulse>
      </View>
    );
  }

  const trainedSomething = data.workouts !== null && (data.workouts.done > 0 || data.workouts.totalMinutes > 0);
  const nothing = data.nutrition === null && !trainedSomething && data.weight === null;

  return (
    <View className="gap-3">
      {switcher}

      {nothing ? (
        <View className="insights__card items-center py-6">
          <View className="coach__option-icon">
            <SymbolView name={{ ios: "chart.bar.fill", android: "bar_chart", web: "bar_chart" }} size={22} tintColor={colors.leaf} />
          </View>
          <Text className="insights__title text-center">{week === "this" ? "Nothing logged this week yet" : "Nothing was logged last week"}</Text>
          <Text className="coach__hint text-center">{`Log your meals and finish a workout, and ${coachName} will show how your week is going and what to change.`}</Text>
          {week === "this" && (
            <View className="flex-row flex-wrap justify-center gap-2 self-stretch">
              <Pressable onPress={() => router.push("/macro/add-meal")} className="coach__ghost flex-1" accessibilityRole="button">
                <Text className="coach__ghost-label">Log a meal</Text>
              </Pressable>
              {data.workouts?.hasPlan && (
                <Pressable onPress={() => router.push("/workout")} className="coach__ghost flex-1" accessibilityRole="button">
                  <Text className="coach__ghost-label">Open workouts</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      ) : (
        <>
          <Overview data={data} />
          <ReviewCard
            coachName={coachName}
            review={data.review}
            canReview={data.canReview}
            reviewing={reviewing}
            error={reviewError}
            onRetry={() => askReview(week)}
            onRefresh={() => askReview(week, true)}
            onAsk={onAsk}
          />
          {data.nutrition ? <NutritionCard n={data.nutrition} /> : <MissingCard title="Nutrition" text={week === "this" ? "No meals logged this week. Log them in Macro to see your averages." : "No meals were logged last week."} />}
          {data.workouts && (trainedSomething || data.workouts.hasPlan) ? (
            <WorkoutCard w={data.workouts} today={data.week.today} />
          ) : (
            <MissingCard title="Workouts" text="No workout plan or sessions this week." />
          )}
          {data.weight && <WeightCard w={data.weight} />}
        </>
      )}
    </View>
  );
}

// The week at a glance: calories, workouts, active days and weight, then the seven days
function Overview({ data }: { data: Insights }) {
  const colors = useThemeColors();
  const n = data.nutrition;
  const w = data.workouts;
  const elapsed = data.week.elapsed;
  // A day counts as active when a meal was logged or a session done
  const active = new Set([...(n?.days.filter((d) => d.logged).map((d) => d.date) ?? []), ...(w?.days.filter((d) => d.status === "completed" || d.minutes > 0).map((d) => d.date) ?? [])]);
  const counted = n?.days.map((d) => d.date) ?? w?.days.slice(0, elapsed).map((d) => d.date) ?? [];
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${data.week.start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const trained = new Set(w?.days.filter((d) => d.status === "completed").map((d) => d.date) ?? []);
  const logged = new Set(n?.days.filter((d) => d.logged).map((d) => d.date) ?? []);

  return (
    <View className="insights__card">
      <Text className="insights__title">Weekly overview</Text>
      <View className="insights__tiles">
        {n && (
          <View className="insights__tile" accessibilityLabel={`Calories: ${n.totalKcal} of ${n.targetKcal} kcal over ${plural(n.daysLogged, "logged day")}`}>
            <Text className="insights__label">Calories</Text>
            <Text numberOfLines={1}>
              <Text className="insights__value">{n.totalKcal.toLocaleString("en-IN")}</Text>
              <Text className="insights__of">{` / ${n.targetKcal.toLocaleString("en-IN")}`}</Text>
            </Text>
            <Text className="coach__hint" numberOfLines={1}>{`kcal · ${plural(n.daysLogged, "day")}`}</Text>
          </View>
        )}
        {w && w.hasPlan && (
          <View className="insights__tile" accessibilityLabel={`Workouts: ${w.done} of ${w.planned} planned done`}>
            <Text className="insights__label">Workouts</Text>
            <Text numberOfLines={1}>
              <Text className="insights__value">{w.done}</Text>
              <Text className="insights__of">{` / ${w.planned}`}</Text>
            </Text>
            <Text className="coach__hint" numberOfLines={1}>{w.completionRate === null ? "planned" : `${w.completionRate}% completed`}</Text>
          </View>
        )}
        <View className="insights__tile" accessibilityLabel={`Active days: ${active.size} of ${elapsed}`}>
          <Text className="insights__label">Active days</Text>
          <Text numberOfLines={1}>
            <Text className="insights__value">{active.size}</Text>
            <Text className="insights__of">{` / ${elapsed}`}</Text>
          </Text>
          <Text className="coach__hint" numberOfLines={1}>meals or training</Text>
        </View>
        {data.weight && data.weight.change !== null && (
          <View className="insights__tile" accessibilityLabel={`Weight: ${data.weight.current.kg} kg, ${kgChange(data.weight.change)}`}>
            <Text className="insights__label">Weight</Text>
            <Text className="insights__value" numberOfLines={1}>{`${data.weight.current.kg} kg`}</Text>
            <Text className="coach__hint" numberOfLines={1}>{kgChange(data.weight.change)}</Text>
          </View>
        )}
      </View>

      <View className="insights__strip" accessibilityLabel={`Days: ${days.map((d) => `${shortDay(d)} ${trained.has(d) ? "trained" : logged.has(d) ? "meals logged" : counted.includes(d) ? "nothing logged" : "still ahead"}`).join(", ")}`}>
        {days.map((d) => {
          const on = active.has(d);
          const ahead = d > data.week.today;
          return (
            <View key={d} className="insights__strip-day">
              <Text className="coach__hint">{weekdayLetter(d)}</Text>
              <View className={on ? "insights__strip-mark insights__strip-mark--on" : "insights__strip-mark"} style={ahead ? { opacity: 0.45 } : undefined}>
                {trained.has(d) ? (
                  <SymbolView name={{ ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" }} size={13} tintColor={colors.onPrimary} />
                ) : logged.has(d) ? (
                  <SymbolView name={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }} size={12} tintColor={colors.onPrimary} />
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

type ReviewProps = {
  coachName: string;
  review: CoachReview | null;
  canReview: boolean;
  reviewing: boolean;
  error: string | null;
  onRetry: () => void;
  onRefresh: () => void;
  onAsk: (question: string) => void;
};

// The coach's review: a summary and a few tips, written from the numbers on this tab
function ReviewCard({ coachName, review, canReview, reviewing, error, onRetry, onRefresh, onAsk }: ReviewProps) {
  const colors = useThemeColors();
  if (!review && !canReview && !reviewing && !error) return null;
  return (
    <View className="insights__card">
      <View className="flex-row items-center gap-2">
        <SymbolView name={{ ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }} size={16} tintColor={colors.leaf} />
        <Text className="insights__title flex-1">{`${coachName}'s review`}</Text>
        {review && review.stale && review.canRefresh && !reviewing && (
          <Pressable onPress={onRefresh} className="coach__pill" accessibilityRole="button" accessibilityLabel="Refresh the review with this week's new numbers">
            <Text className="coach__pill-label">Refresh</Text>
          </Pressable>
        )}
      </View>

      {reviewing && (
        <SkeletonPulse label={`${coachName} is reviewing your week`} className="gap-2">
          <Text className="coach__hint">{`${coachName} is reviewing your week…`}</Text>
          <SkeletonBlock height={12} />
          <SkeletonBlock width="85%" height={12} />
          <SkeletonBlock width="60%" height={12} />
        </SkeletonPulse>
      )}

      {!reviewing && error && (
        <View className="gap-2">
          <Text className="coach__hint" accessibilityRole="alert">{error}</Text>
          {!review && (
            <Pressable onPress={onRetry} className="coach__ghost" accessibilityRole="button">
              <Text className="coach__ghost-label">Try again</Text>
            </Pressable>
          )}
        </View>
      )}

      {!reviewing && review && (
        <>
          <Text className="insights__body">{review.summary}</Text>
          {review.tips.map((tip) => (
            <View key={tip.area} className="insights__tip" accessibilityLabel={`${TIP_LABEL[tip.area]}: ${tip.text}`}>
              <View className="insights__tip-icon">
                <SymbolView name={TIP_ICON[tip.area]} size={14} tintColor={colors.leaf} />
              </View>
              <View className="min-w-0 flex-1 gap-0.5">
                <Text className="insights__label">{TIP_LABEL[tip.area]}</Text>
                <Text className="insights__body">{tip.text}</Text>
              </View>
            </View>
          ))}
          {review.stale && (
            <Text className="coach__hint">{review.canRefresh ? "You've logged more since this review. Tap Refresh for an updated one." : "You've logged more since this review. You can refresh it tomorrow."}</Text>
          )}
          <Pressable onPress={() => onAsk("How can I improve on this week?")} className="coach__ghost" accessibilityRole="button" accessibilityLabel={`Ask ${coachName} about this week`}>
            <Text className="coach__ghost-label">{`Ask ${coachName} about this week`}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function VerdictPill({ verdict }: { verdict: MacroStat["verdict"] }) {
  if (!verdict) return null;
  return (
    <View className={PILL[verdict]}>
      <Text className={PILL_LABEL[verdict]}>{VERDICT_LABEL[verdict]}</Text>
    </View>
  );
}

// Food against the targets: the daily average, the three macros, daily calories, and what's off
function NutritionCard({ n }: { n: NutritionInsights }) {
  const colors = useThemeColors();
  const rows = [
    { key: "proteinG" as const, label: "Protein", color: colors.protein },
    { key: "carbsG" as const, label: "Carbs", color: colors.carbs },
    { key: "fatG" as const, label: "Fat", color: colors.fat },
  ];
  const kcal = n.macros.kcal;
  const tallest = Math.max(n.targets.kcal * 1.25, ...n.days.map((d) => d.kcal));
  // What's short or over, in one line each: "Below target: protein (15%), fat (25%)"
  const all = [{ key: "kcal" as const, label: "Calories" }, ...rows];
  const listOf = (verdict: "low" | "high") =>
    all.filter((r) => n.macros[r.key].verdict === verdict).map((r, i) => `${i === 0 ? r.label : r.label.toLowerCase()} (${n.macros[r.key].percent}%)`);
  const notes = [
    listOf("low").length ? `Below target: ${listOf("low").join(", ")}.` : null,
    listOf("high").length ? `Above target: ${listOf("high").join(", ")}.` : null,
  ].filter((note): note is string => note !== null);
  const letters = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${n.days[0].date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return weekdayLetter(d.toISOString().slice(0, 10));
  });

  return (
    <View className="insights__card">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="insights__title">Nutrition</Text>
        <VerdictPill verdict={kcal.verdict} />
      </View>

      <View accessibilityLabel={`Average ${kcal.avg} of ${kcal.target} kcal a day, on ${plural(n.daysLogged, "logged day")}`}>
        <Text className="insights__label">Average a day</Text>
        <Text numberOfLines={1}>
          <Text className="insights__big">{kcal.avg.toLocaleString("en-IN")}</Text>
          <Text className="insights__of">{` / ${kcal.target.toLocaleString("en-IN")} kcal`}</Text>
        </Text>
        <Text className="coach__hint">{`Over the ${plural(n.daysLogged, "day")} you logged, of ${n.daysCounted}`}</Text>
      </View>

      {/* Daily calories, target as the line */}
      <View accessibilityLabel={`Daily calories: ${n.days.map((d) => `${shortDay(d.date)} ${d.logged ? `${d.kcal} kcal` : "not logged"}`).join(", ")}`}>
        <View className="insights__bars">
          <View className="insights__target-line" style={{ bottom: (n.targets.kcal / tallest) * 72 }} />
          {n.days.map((d) => {
            const ratio = d.kcal / n.targets.kcal;
            const color = !d.logged ? undefined : ratio > 1.15 ? colors.danger : ratio >= 0.9 ? colors.primary : colors.lineStrong;
            return <View key={d.date} className="insights__bar" style={{ height: d.logged ? Math.max(4, (d.kcal / tallest) * 72) : 3, backgroundColor: color }} />;
          })}
          {Array.from({ length: 7 - n.days.length }, (_, i) => <View key={`ahead-${i}`} className="flex-1" />)}
        </View>
        <View className="mt-1 flex-row gap-2">
          {letters.map((letter, i) => (
            <Text key={i} className="coach__hint flex-1 text-center">{letter}</Text>
          ))}
        </View>
      </View>

      <View className="gap-3">
        {rows.map((r) => {
          const m = n.macros[r.key];
          return (
            <View key={r.key} className="gap-1.5" accessibilityLabel={`${r.label}: average ${Math.round(m.avg)} of ${m.target} grams, ${m.percent}%`}>
              <View className="flex-row items-center justify-between gap-2">
                <Text className="insights__label">{r.label}</Text>
                <View className="flex-row items-center gap-2">
                  <Text className="coach__hint">{`${Math.round(m.avg)} / ${m.target} g · ${m.percent}%`}</Text>
                  <VerdictPill verdict={m.verdict} />
                </View>
              </View>
              <View className="coach__bar">
                <View className="coach__bar-fill" style={{ width: `${Math.min(m.percent ?? 0, 100)}%`, backgroundColor: r.color }} />
              </View>
            </View>
          );
        })}
      </View>

      <View className="insights__tiles">
        <View className="insights__tile">
          <Text className="insights__label">Calorie goal met</Text>
          <Text numberOfLines={1}>
            <Text className="insights__value">{n.onTargetDays}</Text>
            <Text className="insights__of">{` / ${plural(n.daysLogged, "day")}`}</Text>
          </Text>
        </View>
        <View className="insights__tile">
          <Text className="insights__label">Protein target hit</Text>
          <Text numberOfLines={1}>
            <Text className="insights__value">{n.proteinHitDays}</Text>
            <Text className="insights__of">{` / ${plural(n.daysLogged, "day")}`}</Text>
          </Text>
        </View>
      </View>

      {notes.length > 0 && (
        <View className="insights__note gap-1">
          {notes.map((note) => (
            <Text key={note} className="coach__hint">{note}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

// Training: done against planned, minutes, the week's sessions and the muscle groups worked
function WorkoutCard({ w, today }: { w: WorkoutInsights; today: string }) {
  const colors = useThemeColors();
  const status = (s: WorkoutInsights["days"][number]) =>
    s.status === "completed" ? "done" : s.status === "missed" ? "missed" : s.status === "rest" ? "rest" : s.date >= today ? "ahead" : "missed";
  return (
    <View className="insights__card">
      <Text className="insights__title">Workouts</Text>
      <View className="insights__tiles">
        <View className="insights__tile" accessibilityLabel={w.hasPlan ? `${w.done} of ${w.planned} planned workouts done` : `${plural(w.done, "workout")} done`}>
          <Text className="insights__label">Completed</Text>
          <Text numberOfLines={1}>
            <Text className="insights__value">{w.done}</Text>
            {w.hasPlan && <Text className="insights__of">{` / ${w.planned}`}</Text>}
          </Text>
          <Text className="coach__hint" numberOfLines={1}>{w.completionRate === null ? (w.upcoming > 0 ? `${w.upcoming} still ahead` : "sessions") : `${w.completionRate}% completion`}</Text>
        </View>
        <View className="insights__tile" accessibilityLabel={`${w.totalMinutes} minutes trained`}>
          <Text className="insights__label">Time trained</Text>
          <Text numberOfLines={1}>
            <Text className="insights__value">{w.totalMinutes}</Text>
            <Text className="insights__of"> min</Text>
          </Text>
          <Text className="coach__hint" numberOfLines={1}>{`${plural(w.activeDays, "active day")}`}</Text>
        </View>
      </View>

      {w.hasPlan && w.completionRate !== null && (
        <View className="coach__bar" accessibilityLabel={`Completion ${w.completionRate}%`}>
          <View className="coach__bar-fill" style={{ width: `${w.completionRate}%`, backgroundColor: colors.primary }} />
        </View>
      )}

      <View className="insights__strip">
        {w.days.map((d) => {
          const s = status(d);
          return (
            <View key={d.date} className="insights__strip-day" accessibilityLabel={`${shortDay(d.date)}: ${s}${d.minutes ? `, ${d.minutes} min` : ""}`}>
              <Text className="coach__hint">{weekdayLetter(d.date)}</Text>
              <View className={s === "done" ? "insights__strip-mark insights__strip-mark--on" : s === "missed" ? "insights__strip-mark insights__strip-mark--missed" : "insights__strip-mark"}>
                {s === "done" && <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={13} tintColor={colors.onPrimary} />}
                {s === "missed" && <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={11} tintColor={colors.faint} />}
                {s === "ahead" && <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colors.primary }} />}
              </View>
            </View>
          );
        })}
      </View>
      <Text className="coach__hint">
        {[w.done ? `${w.done} done` : null, w.missed ? `${w.missed} missed` : null, w.upcoming ? `${w.upcoming} ahead` : null].filter(Boolean).join(" · ") || "No sessions planned this week"}
      </Text>

      {w.muscleGroups.length > 0 && (
        <View className="gap-2">
          <Text className="insights__label">Muscle groups trained</Text>
          <View className="flex-row flex-wrap gap-2">
            {w.muscleGroups.map((g) => (
              <View key={g.group} className="insights__muscle" accessibilityLabel={`${MUSCLE_LABEL[g.group] ?? g.group}: ${plural(g.sets, "set")}`}>
                <Text className="insights__muscle-label">{`${MUSCLE_LABEL[g.group] ?? g.group} · ${plural(g.sets, "set")}`}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

// Weight from what the member entered: shown only when they did
function WeightCard({ w }: { w: WeightInsights }) {
  const colors = useThemeColors();
  const good = w.change === null ? null : changeIsGood(w.change, w.direction);
  const tone = good === null ? colors.muted : good ? colors.success : colors.warning;
  const low = Math.min(...w.points.map((p) => p.kg));
  const high = Math.max(...w.points.map((p) => p.kg));
  const span = Math.max(high - low, 1);
  return (
    <View className="insights__card">
      <Text className="insights__title">Weight & progress</Text>
      <View className="flex-row items-end justify-between gap-3">
        <View accessibilityLabel={`Current weight ${w.current.kg} kg, entered ${shortDay(w.current.date)}`}>
          <Text className="insights__label">Current</Text>
          <Text className="insights__big">{`${w.current.kg} kg`}</Text>
          <Text className="coach__hint">{shortDay(w.current.date)}</Text>
        </View>
        {w.change !== null && (
          <View className="items-end">
            <Text className="insights__value" style={{ color: tone }}>{kgChange(w.change)}</Text>
            {w.direction && <Text className="coach__hint">{GOAL_LABEL[w.direction]}</Text>}
          </View>
        )}
      </View>

      {w.points.length > 2 && (
        <View className="h-12 flex-row items-end gap-2" accessibilityLabel={`Weight entries: ${w.points.map((p) => `${shortDay(p.date)} ${p.kg} kg`).join(", ")}`}>
          {w.points.map((p, i) => (
            <View key={p.date} className="flex-1 rounded-t" style={{ height: 10 + ((p.kg - low) / span) * 38, backgroundColor: i === w.points.length - 1 ? colors.primary : colors.creamTab }} />
          ))}
        </View>
      )}

      <View className="insights__tiles">
        {w.previous ? (
          <View className="insights__tile">
            <Text className="insights__label">Previous</Text>
            <Text className="insights__value">{`${w.previous.kg} kg`}</Text>
            <Text className="coach__hint">{`${shortDay(w.previous.date)} · ${plural(daysBetween(w.previous.date, w.current.date), "day")} before`}</Text>
          </View>
        ) : (
          <View className="insights__note flex-1">
            <Text className="coach__hint">Update your weight in Profile › Measurements to see how it changes.</Text>
          </View>
        )}
        {w.first && w.changeSinceFirst !== null && w.first.date !== w.previous?.date && (
          <View className="insights__tile">
            <Text className="insights__label">{`Since ${shortDay(w.first.date)}`}</Text>
            <Text className="insights__value">{kgChange(w.changeSinceFirst)}</Text>
            <Text className="coach__hint">{`from ${w.first.kg} kg`}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function MissingCard({ title, text }: { title: string; text: string }) {
  return (
    <View className="insights__card">
      <Text className="insights__title">{title}</Text>
      <Text className="coach__hint">{text}</Text>
    </View>
  );
}
