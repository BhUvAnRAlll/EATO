import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";

import { IconButton } from "@/components/IconButton";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ProgramCard } from "@/components/ProgramCard";
import { WorkoutSheet } from "@/components/workout/WorkoutSheet";
import { addDays, dateOf, todayIso } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import {
  LEVEL_LABEL,
  STATUS_LABEL,
  historyDate,
  sessionIcon,
  weekOf,
  weekdayName,
  workoutApi,
  type DayStatus,
  type HistoryDay,
  type WorkoutHome,
} from "@/lib/workoutApi";
import { colors } from "@/theme";

// The Fitness tab: today's session, the training week and the last seven days. The plan
// comes from the workout engine; the first visit with no plan builds one from the profile.

type Load = { state: "loading" } | { state: "building" } | { state: "failed"; error: string } | { state: "ready"; home: Extract<WorkoutHome, { plan: object }>; history: HistoryDay[] };

const dotColor: Record<DayStatus, string | null> = {
  missed: colors.danger,
  completed: colors.success,
  in_progress: colors.warning,
  planned: colors.creamLine,
  rest: null,
};

const pillColors: Record<Exclude<DayStatus, "rest">, { background: string; text: string }> = {
  completed: { background: colors.successSoft, text: colors.success },
  in_progress: { background: colors.warningSoft, text: colors.ink },
  missed: { background: colors.dangerSoft, text: colors.ink },
  planned: { background: colors.surfaceAlt, text: colors.muted },
};

// A tapped day that asks before it changes anything: a missed one can move to today, and a
// later one can swap with today's session
type Prompt = { kind: "move" | "swap"; date: string };

const moon = { ios: "moon.stars.fill", android: "bedtime", web: "bedtime" } as const;

export default function WorkoutHub() {
  const getToken = useSessionToken();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [showAll, setShowAll] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const latest = useRef(0);

  // The plan, this week and the last seven days. With no plan yet one is built from the
  // profile first (a member should never meet an empty workout tab).
  const refresh = useCallback(async () => {
    const request = ++latest.current;
    const today = todayIso();
    const token = await getToken().catch(() => null);
    let home = await workoutApi.home(token, today, weekOf(today), today);
    if (home.ok && home.data.plan === null) {
      if (request === latest.current) setLoad({ state: "building" });
      const ensured = await workoutApi.ensurePlan(token, today);
      if (!ensured.ok) {
        if (request === latest.current) setLoad({ state: "failed", error: ensured.error });
        return;
      }
      home = await workoutApi.home(token, today, weekOf(today), today);
    }
    const history = await workoutApi.history(token, addDays(today, -6), today, today);
    if (request !== latest.current) return;
    if (!home.ok) return setLoad({ state: "failed", error: home.error });
    if (home.data.plan === null) return setLoad({ state: "failed", error: "Your plan isn't ready yet" });
    setLoad({ state: "ready", home: home.data, history: history.ok ? history.data.days : [] });
  }, [getToken]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const retry = () => {
    setLoad({ state: "loading" });
    refresh();
  };
  const openDay = (date: string) => router.push({ pathname: "/workout/day", params: { date } });
  const ask = (next: Prompt) => {
    setPromptError(null);
    setPrompt(next);
  };
  const closePrompt = () => {
    if (busy) return;
    setPrompt(null);
    setPromptError(null);
  };

  // Move or swap, then reload the hub so the week and today's card show the new order
  const confirmPrompt = async () => {
    if (!prompt || busy) return;
    setBusy(true);
    setPromptError(null);
    const today = todayIso();
    const token = await getToken().catch(() => null);
    const result = prompt.kind === "move" ? await workoutApi.moveToToday(token, prompt.date, today) : await workoutApi.swapWithToday(token, prompt.date, today);
    setBusy(false);
    if (!result.ok) return setPromptError(result.error || "That did not work. Try again.");
    setPrompt(null);
    await refresh();
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 20 }} showsVerticalScrollIndicator={false}>
          {/* Opened from Profile (no longer a tab), so it has a way back; preferences only once
              there is a plan to change */}
          <View className="app-bar">
            <IconButton icon={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/profile"))} />
            <Text className="app-bar__title" numberOfLines={1}>Workout</Text>
            <IconButton icon={{ ios: "gearshape", android: "settings", web: "settings" }} label="Workout preferences" onPress={() => router.push("/workout/preferences")} disabled={load.state !== "ready"} />
          </View>

          {load.state === "loading" || load.state === "building" ? (
            <View className="items-center gap-3 py-16">
              <ActivityIndicator color={colors.forest} />
              <Text className="home__note">{load.state === "building" ? "Building your plan" : "Loading"}</Text>
            </View>
          ) : load.state === "failed" ? (
            <DashedBlock
              icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }}
              title="Could not set up your plan"
              text={`${load.error.replace(/\.$/, "")}. Tap to try again.`}
              onPress={retry}
            />
          ) : (
            <Ready home={load.home} history={load.history} showAll={showAll} onToggleAll={() => setShowAll((v) => !v)} openDay={openDay} ask={ask} />
          )}
        </ScrollView>
      </SafeAreaView>
      <WorkoutSheet
        visible={prompt !== null}
        emoji={prompt?.kind === "swap" ? "🔁" : "💪"}
        title={prompt?.kind === "swap" ? "Swap with today?" : "Do it today instead?"}
        text={
          prompt?.kind === "swap"
            ? `Today's session and ${weekdayName(prompt.date)} will trade places.`
            : `You missed ${prompt ? weekdayName(prompt.date) : "that day"}. Move that session to today and pick up where you left off.`
        }
        confirmLabel={prompt?.kind === "swap" ? "Swap days" : "Move to today"}
        cancelLabel="Not now"
        busy={busy}
        error={promptError}
        onConfirm={confirmPrompt}
        onCancel={closePrompt}
      />
    </View>
  );
}

type ReadyProps = {
  home: Extract<WorkoutHome, { plan: object }>;
  history: HistoryDay[];
  showAll: boolean;
  onToggleAll: () => void;
  openDay: (date: string) => void;
  ask: (prompt: Prompt) => void;
};

function Ready({ home, history, showAll, onToggleAll, openDay, ask }: ReadyProps) {
  const { plan, day, status, date: today, week } = home;
  const scheduled = week.filter((d) => d.status !== "rest").length;
  const done = week.filter((d) => d.status === "completed").length;
  const visible = showAll ? history : history.slice(0, 3);
  const action = status === "completed" ? "Review" : status === "in_progress" ? "Continue" : "Start";

  // Today opens; a past missed day offers to move here; a later scheduled day offers to swap
  // with today's session (when today has one); anything else just opens
  const tapDay = (date: string, dayStatus: DayStatus) => {
    if (date === today) return openDay(date);
    if (date < today && dayStatus === "missed") return ask({ kind: "move", date });
    if (date > today && dayStatus === "planned" && day) return ask({ kind: "swap", date });
    openDay(date);
  };

  return (
    <>
      {/* Today */}
      {day ? (
        <Pressable
          onPress={() => openDay(today)}
          className="workout__hero"
          style={{ height: 232 }}
          accessibilityRole="button"
          accessibilityLabel={`Today: ${day.title}, ${day.minutes} min, ${day.exerciseCount} exercises. ${action}`}
        >
          <View className="flex-1 items-center justify-center pb-12">
            <SymbolView name={sessionIcon(day.sessionType)} size={72} tintColor={colors.onInverseMuted} />
          </View>
          <View className="absolute left-4 right-4 top-4 flex-row items-start justify-between">
            <View className="flex-row flex-wrap gap-2">
              <View className="workout__chip workout__chip--accent">
                <SymbolView name={{ ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" }} size={13} tintColor={colors.onPrimary} />
                <Text className="workout__chip-label workout__chip-label--accent">Today</Text>
              </View>
              {plan.source === "trainer" && (
                <View className="workout__chip">
                  <Text className="workout__chip-label">Trainer plan</Text>
                </View>
              )}
            </View>
            <View className="workout__chip">
              <Text className="workout__chip-label">{day.minutes} min</Text>
            </View>
          </View>
          <View className="absolute bottom-4 left-4 right-4 flex-row items-end gap-3">
            <View className="min-w-0 flex-1">
              <Text className="activity-card__title" numberOfLines={2}>{day.title}</Text>
              <Text className="activity-card__meta">{`${day.exerciseCount} exercises · ${LEVEL_LABEL[plan.level]} · ${action}`}</Text>
            </View>
            <IconButton icon={{ ios: "play.fill", android: "play_arrow", web: "play_arrow" }} label={action} variant="primary" size={56} glow />
          </View>
        </Pressable>
      ) : (
        <View className="home__card flex-row items-center gap-4">
          <View className="flex-1 gap-1.5">
            <Text className="type-overline text-muted">Rest day</Text>
            <Text className="type-subhead text-forest-ink">Recharge to come back stronger</Text>
            <Text className="post__time">Nothing scheduled today. Recovery is part of the plan.</Text>
            <View className="workout__pill mt-1 self-start" style={{ backgroundColor: colors.successSoft }}>
              <Text className="workout__pill-label" style={{ color: colors.success }}>Rest · Recover · Be ready</Text>
            </View>
          </View>
          <SymbolView name={moon} size={52} tintColor={colors.primary} />
        </View>
      )}

      {/* This week */}
      <View className="gap-3">
        <View className="flex-row items-baseline justify-between">
          <Text className="setup__section">This week</Text>
          <Text className="post__time">{`${done} of ${scheduled} done`}</Text>
        </View>
        <View className="flex-row gap-1.5">
          {week.map(({ date, status: dayStatus }) => {
            const isToday = date === today;
            const dot = dotColor[dayStatus];
            const d = dateOf(date);
            return (
              <Pressable
                key={date}
                onPress={() => {
                  if (!isToday) Haptics.selectionAsync().catch(() => {});
                  tapDay(date, dayStatus);
                }}
                className={isToday ? "workout__tile workout__tile--today" : "workout__tile"}
                accessibilityRole="button"
                accessibilityLabel={`${d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}: ${STATUS_LABEL[dayStatus]}`}
              >
                <Text className="type-caption" style={{ color: isToday ? colors.white : colors.muted }}>
                  {d.toLocaleDateString("en-GB", { weekday: "narrow" })}
                </Text>
                <Text className="type-subhead" style={{ color: isToday ? colors.white : colors.forestInk }}>{d.getDate()}</Text>
                <View className="workout__dot" style={{ backgroundColor: dot ?? "transparent" }} />
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* History */}
      <View className="gap-3">
        <View className="flex-row items-baseline justify-between">
          <Text className="setup__section">History</Text>
          {history.length > 3 && (
            <Pressable onPress={onToggleAll} hitSlop={8} accessibilityRole="button">
              <Text className="home__link">{showAll ? "Show less" : "See all"}</Text>
            </Pressable>
          )}
        </View>
        {history.length === 0 ? (
          <DashedBlock icon={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }} title="No sessions yet" text="Finish a workout and it will show up here." />
        ) : (
          <View className="gap-3">
            {visible.map((row) => {
              const pill = pillColors[row.status];
              return (
                <ProgramCard
                  key={row.date}
                  title={row.title ?? "Session"}
                  icon={sessionIcon(row.sessionType)}
                  meta={[
                    { icon: { ios: "calendar", android: "calendar_today", web: "calendar_today" }, text: historyDate(row.date) },
                    { icon: { ios: "clock", android: "schedule", web: "schedule" }, text: `${row.totalMinutes} min` },
                    { icon: { ios: "bolt", android: "bolt", web: "bolt" }, text: `${row.exerciseCount} exercises` },
                  ]}
                  badge={{ label: STATUS_LABEL[row.status], background: pill.background, color: pill.text }}
                  onPress={() => tapDay(row.date, row.status)}
                  accessibilityLabel={`${row.title ?? "Session"}, ${historyDate(row.date)}: ${STATUS_LABEL[row.status]}`}
                />
              );
            })}
          </View>
        )}
      </View>
    </>
  );
}
