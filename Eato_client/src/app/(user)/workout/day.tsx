import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { ActionSheet } from "@/components/community/ActionSheet";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { isValidIso, longDate, todayIso } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import {
  GOAL_FOCUS,
  GOAL_LABEL,
  LEVEL_LABEL,
  MUSCLE_ICON,
  MUSCLE_LABEL,
  PATTERN_FOCUS,
  SECTION_HINT,
  SECTION_LABEL,
  formatSeconds,
  formatSets,
  isTimed,
  sessionIcon,
  weekOf,
  workoutApi,
  type DayExercise,
  type Plan,
  type Section,
  type TrainingDay,
  type WorkoutHome,
} from "@/lib/workoutApi";
import { colors } from "@/theme";

// One day's session in full: what it trains, the exercise list by section, and the facts
// about it. Opened from the hub with a `date`, falling back to today. The session player
// (Start Workout) is the next slice; until then the footer shows the day's status only.

type Tab = "exercises" | "muscles" | "about";
type Ready = { plan: Plan; status: Extract<WorkoutHome, { plan: object }>["status"]; day: TrainingDay | null };

const SECTIONS: Section[] = ["warmup", "workout", "cooldown"];

export default function TrainingDayScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const today = todayIso();
  const date = isValidIso(params.date) ? params.date : today;
  const isToday = date === today;
  const insets = useSafeAreaInsets();
  const getToken = useSessionToken();
  const [load, setLoad] = useState<{ state: "loading" } | { state: "failed"; error: string } | ({ state: "ready" } & Ready)>({ state: "loading" });
  const [tab, setTab] = useState<Tab>("exercises");
  const [menuFor, setMenuFor] = useState<DayExercise | null>(null);
  const [howTo, setHowTo] = useState<DayExercise | null>(null);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++latest.current;
    const token = await getToken().catch(() => null);
    const result = await workoutApi.home(token, date, weekOf(date), today);
    if (request !== latest.current) return;
    if (!result.ok) return setLoad({ state: "failed", error: result.error });
    if (result.data.plan === null) return setLoad({ state: "failed", error: "You don't have a workout plan yet" });
    setLoad({ state: "ready", plan: result.data.plan, status: result.data.status, day: result.data.day });
  }, [getToken, date, today]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const back = () => (router.canGoBack() ? router.back() : router.replace("/fitness"));
  const when = isToday ? "Today" : longDate(date);

  if (load.state !== "ready" || !load.day) {
    return (
      <View className="flex-1 bg-cream" style={{ paddingTop: insets.top }}>
        <StatusBar style="dark" />
        <View className="flex-row items-center px-5 pt-2">
          <RoundButton icon={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} label="Back" onPress={back} light />
        </View>
        <View className="px-5 pt-6">
          {load.state === "loading" ? (
            <View className="items-center gap-3 py-16">
              <ActivityIndicator color={colors.forest} />
              <Text className="home__note">Loading</Text>
            </View>
          ) : load.state === "failed" ? (
            <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load this day" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={() => { setLoad({ state: "loading" }); refresh(); }} />
          ) : (
            <DashedBlock
              icon={{ ios: "moon.stars.fill", android: "bedtime", web: "bedtime" }}
              title="Rest day"
              text={isToday ? "Nothing scheduled today. Recovery is part of the plan." : "Nothing is scheduled on this day."}
            />
          )}
        </View>
      </View>
    );
  }

  const { plan, day, status } = load;
  const share = () => {
    const lines = day.exercises.map((e) => `• ${e.name}: ${formatSets(e)}`);
    Share.share({ message: [`${day.title} · ${longDate(date)}`, `${day.minutes} min`, "", ...lines].join("\n") }).catch(() => {});
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        {/* Art: the session's figure on the dark surface (the plan has no photos yet) */}
        <View className="bg-ink" style={{ paddingTop: insets.top + 64, paddingHorizontal: 20, paddingBottom: 48, gap: 12 }}>
          <View className="absolute right-6" style={{ top: insets.top + 56 }}>
            <SymbolView name={sessionIcon(day.sessionType)} size={110} tintColor={colors.primary} style={{ opacity: 0.35 }} />
          </View>
          <View className="flex-row flex-wrap gap-2">
            <View className="workout__chip workout__chip--accent">
              <Text className="workout__chip-label workout__chip-label--accent">{LEVEL_LABEL[plan.level]}</Text>
            </View>
            {plan.source === "trainer" && (
              <View className="workout__chip">
                <Text className="workout__chip-label">Trainer plan</Text>
              </View>
            )}
          </View>
          <Text className="text-white" style={{ fontSize: 28, lineHeight: 34, fontWeight: "800" }} numberOfLines={2}>
            {`${day.title} · ${GOAL_FOCUS[plan.goal]}`}
          </Text>
          <Text style={{ color: colors.white, opacity: 0.8 }}>{`${when} · Main Workout`}</Text>
          <View className="workout__stats mt-2">
            <Stat value={String(day.exerciseCount)} label="Exercises" />
            <View style={{ width: 1, alignSelf: "stretch", backgroundColor: "rgba(255,255,255,0.25)" }} />
            <Stat value={String(day.minutes)} unit="min" label="Duration" />
          </View>
        </View>

        {/* Sheet */}
        <View className="workout__sheet px-5" style={{ gap: 16 }}>
          <View className="flex-row rounded-full bg-cream-tab p-1">
            {(["exercises", "muscles", "about"] as Tab[]).map((t) => (
              <Pressable key={t} onPress={() => setTab(t)} className={tab === t ? "workout__tab workout__tab--active" : "workout__tab"} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
                <Text className="type-subhead" style={{ color: tab === t ? colors.white : colors.muted, fontSize: 14 }}>
                  {t === "exercises" ? "Exercises" : t === "muscles" ? "Muscles" : "About"}
                </Text>
              </Pressable>
            ))}
          </View>

          {tab === "exercises" && <ExercisesTab day={day} onMore={setMenuFor} />}
          {tab === "muscles" && <MusclesTab day={day} />}
          {tab === "about" && <AboutTab plan={plan} day={day} />}
        </View>
      </ScrollView>

      {/* Floating buttons over the art */}
      <View className="absolute left-0 right-0 flex-row justify-between px-5" style={{ top: insets.top + 8 }}>
        <RoundButton icon={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} label="Back" onPress={back} />
        <RoundButton icon={{ ios: "square.and.arrow.up", android: "share", web: "share" }} label="Share this session" onPress={share} />
      </View>

      {/* Footer: the day's status (the session player comes in the next slice) */}
      <View className="absolute bottom-0 left-0 right-0 border-t border-cream-line bg-cream px-5 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 12) + 4 }}>
        <Footer status={status} isToday={isToday} date={date} today={today} />
      </View>

      <ActionSheet
        visible={menuFor !== null}
        title={menuFor ? `${menuFor.name}: ${formatSets(menuFor)}` : undefined}
        actions={menuFor ? [{ label: "How to do it", onPress: () => setHowTo(menuFor) }] : []}
        onClose={() => setMenuFor(null)}
      />
      <HowToSheet exercise={howTo} onClose={() => setHowTo(null)} />
    </View>
  );
}

function RoundButton({ icon, label, onPress, light = false }: { icon: React.ComponentProps<typeof SymbolView>["name"]; label: string; onPress: () => void; light?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      className="h-11 w-11 items-center justify-center rounded-full"
      style={{ backgroundColor: light ? colors.white : "rgba(255,255,255,0.18)" }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <SymbolView name={icon} size={18} tintColor={light ? colors.forestInk : colors.white} />
    </Pressable>
  );
}

function Stat({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <View className="flex-1 items-center">
      <Text className="text-white" style={{ fontSize: 20, lineHeight: 24, fontWeight: "800" }}>
        {value}
        {unit && <Text style={{ fontSize: 13, fontWeight: "600" }}>{` ${unit}`}</Text>}
      </Text>
      <Text style={{ color: colors.white, opacity: 0.75, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

function ExercisesTab({ day, onMore }: { day: TrainingDay; onMore: (e: DayExercise) => void }) {
  const groups = SECTIONS.map((section) => ({ section, items: day.exercises.filter((e) => e.section === section) })).filter((g) => g.items.length > 0);
  return (
    <View style={{ gap: 18 }}>
      {groups.map(({ section, items }, index) => (
        <View key={section} className="gap-2.5">
          <View className="flex-row items-baseline justify-between">
            <Text className="setup__section">
              {SECTION_LABEL[section]}
              <Text className="post__time">{` · ${day.sectionMinutes[section]} min`}</Text>
            </Text>
            {index === 0 && <Text className="post__time">{`${day.totalSets} sets total`}</Text>}
          </View>
          {SECTION_HINT[section] && <Text className="post__time">{SECTION_HINT[section]}</Text>}
          {items.map((e) => (
            <ExerciseRow key={e.id} exercise={e} onMore={() => onMore(e)} />
          ))}
        </View>
      ))}
    </View>
  );
}

function ExerciseRow({ exercise: e, onMore }: { exercise: DayExercise; onMore: () => void }) {
  const timed = isTimed(e);
  const muscle = MUSCLE_LABEL[e.muscleGroup] ?? e.muscleGroup;
  const focus = PATTERN_FOCUS[e.pattern];
  // "Back · Lats", but just "Chest" when the focus says the same thing
  const subtitle = focus && focus !== muscle ? `${muscle} · ${focus}` : muscle;
  const right = timed ? `${e.sets.length} ${e.sets.length === 1 ? "set" : "sets"}` : `${e.sets.length} × ${e.repsMin ?? e.sets[0]?.reps ?? 0}–${e.repsMax ?? e.sets[0]?.reps ?? 0}`;
  const under = timed ? formatSeconds(e.sets[0]?.durationSec ?? 0) : "sets × reps";
  return (
    <View className="home__card gap-2" style={{ padding: 12 }}>
      <View className="flex-row items-center gap-3">
        <View className="items-center justify-center rounded-md" style={{ width: 52, height: 52, backgroundColor: colors.forestSoft }}>
          <SymbolView name={MUSCLE_ICON[e.muscleGroup] ?? MUSCLE_ICON.full_body} size={24} tintColor={colors.forest} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="card__title" numberOfLines={2}>{e.name}</Text>
          <Text className="post__time" numberOfLines={1}>{subtitle}</Text>
        </View>
        <View className="items-end">
          <Text className="type-subhead text-forest-ink">{right}</Text>
          <Text className="post__time">{under}</Text>
        </View>
        {/* Only exercises with steps to read get the menu (the warm-ups have none) */}
        {e.instructions.length > 0 ? (
          <Pressable onPress={onMore} hitSlop={10} className="h-9 w-9 items-center justify-center" accessibilityRole="button" accessibilityLabel={`More about ${e.name}`}>
            <SymbolView name={{ ios: "ellipsis", android: "more_horiz", web: "more_horiz" }} size={18} tintColor={colors.muted} />
          </Pressable>
        ) : (
          <View className="h-9 w-9" />
        )}
      </View>
      {e.note && <Text className="post__time" style={{ color: colors.leaf }}>{e.note}</Text>}
    </View>
  );
}

function MusclesTab({ day }: { day: TrainingDay }) {
  const rows = useMemo(() => {
    const byGroup = new Map<string, { exercises: number; sets: number }>();
    for (const e of day.exercises) {
      const row = byGroup.get(e.muscleGroup) ?? { exercises: 0, sets: 0 };
      row.exercises += 1;
      row.sets += e.sets.length;
      byGroup.set(e.muscleGroup, row);
    }
    return [...byGroup].map(([group, r]) => ({ group, ...r })).sort((a, b) => b.sets - a.sets || a.group.localeCompare(b.group));
  }, [day]);
  const busiest = Math.max(1, ...rows.map((r) => r.sets));
  return (
    <View className="gap-2.5">
      {rows.map((r) => (
        <View key={r.group} className="home__card gap-2" style={{ padding: 12 }}>
          <View className="flex-row items-center gap-3">
            <SymbolView name={MUSCLE_ICON[r.group] ?? MUSCLE_ICON.full_body} size={20} tintColor={colors.forest} />
            <Text className="card__title flex-1">{MUSCLE_LABEL[r.group] ?? r.group}</Text>
            <Text className="post__time">{`${r.exercises} exercises · ${r.sets} sets`}</Text>
          </View>
          <View className="h-2 overflow-hidden rounded-full bg-cream-tab">
            <View className="h-2 rounded-full" style={{ width: `${Math.round((r.sets / busiest) * 100)}%`, backgroundColor: colors.leaf }} />
          </View>
        </View>
      ))}
    </View>
  );
}

function AboutTab({ plan, day }: { plan: Plan; day: TrainingDay }) {
  const rows: [string, string][] = [
    ["Level", LEVEL_LABEL[plan.level]],
    ["Goal", GOAL_LABEL[plan.goal]],
    ["Session", day.title],
    ["Duration", `${day.minutes} min`],
    ["Exercises", `${day.exerciseCount} · ${day.setCount} sets`],
    ...(day.kcal !== null ? ([["Estimated burn", `~${day.kcal} kcal`]] as [string, string][]) : []),
    ["Planned by", plan.source === "trainer" ? "Your trainer" : "EATO workout engine"],
  ];
  return (
    <View className="home__card" style={{ paddingVertical: 4 }}>
      {rows.map(([label, value], i) => (
        <View key={label} className="flex-row items-center justify-between py-3" style={i < rows.length - 1 ? { borderBottomWidth: 1, borderColor: colors.creamLine } : undefined}>
          <Text className="post__time">{label}</Text>
          <Text className="card__title">{value}</Text>
        </View>
      ))}
    </View>
  );
}

function Footer({ status, isToday, date, today }: { status: Ready["status"]; isToday: boolean; date: string; today: string }) {
  if (isToday && status === "completed") {
    return (
      <View className="h-control-lg flex-row items-center justify-center gap-2 rounded-full" style={{ backgroundColor: colors.successSoft }}>
        <SymbolView name={{ ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" }} size={18} tintColor={colors.success} />
        <Text className="type-subhead" style={{ color: colors.success }}>Completed</Text>
      </View>
    );
  }
  const label = isToday
    ? status === "in_progress" ? "Continue Workout" : "Start Workout"
    : status === "completed" ? "Completed" : status === "missed" ? "Missed" : date > today ? "Not yet" : "Not today";
  // Starting a session belongs to the session player (next slice), so the button can't start one yet
  return (
    <View className="btn-forest" style={{ opacity: 0.45 }} accessibilityRole="button" accessibilityState={{ disabled: true }} accessibilityLabel={label}>
      <Text className="btn-forest__label">{label}</Text>
    </View>
  );
}

function HowToSheet({ exercise, onClose }: { exercise: DayExercise | null; onClose: () => void }) {
  return (
    <Modal visible={exercise !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="verify__backdrop" onPress={onClose} accessibilityLabel="Close">
        <Pressable className="verify__sheet gap-3" onPress={() => {}} accessibilityViewIsModal>
          <Text className="setup__section text-center">{exercise ? `How to do it: ${exercise.name}` : ""}</Text>
          {exercise?.instructions.map((line, i) => (
            <Text key={i} className="type-body text-forest-ink">{`${i + 1}. ${line}`}</Text>
          ))}
          <Pressable onPress={onClose} className="btn-forest mt-1" accessibilityRole="button">
            <Text className="btn-forest__label">Done</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
