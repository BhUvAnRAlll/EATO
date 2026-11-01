import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";

import { BottomSheet } from "@/components/BottomSheet";
import { IconButton } from "@/components/IconButton";
import { FitnessCategorySection } from "@/components/fitness/FitnessCategorySection";
import { FitnessHeader } from "@/components/fitness/FitnessHeader";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ProgramCard } from "@/components/ProgramCard";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { WorkoutSheet } from "@/components/workout/WorkoutSheet";
import { CENTER_KIT_LABEL, HOME_KIT_LABEL, fitnessApi, type CenterKit, type Equipment, type HomeKit, type ProgramCardData, type ProgramList } from "@/lib/fitnessApi";
import { addDays, dateOf, longDate, todayIso } from "@/lib/macro";
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
  type Place,
  type WorkoutHome,
} from "@/lib/workoutApi";
import { useThemeColors, Palette } from "@/theme";

// The Fitness tab (the Workout tab until 2026-11-02): a fixed header (AT HOME / AT CENTER, where
// you train, search), today's session and the training week, then the six sections of free
// programs for the place (Popular, Categories, Build Muscle, Stay Fit, Dance, Workplace Wellness),
// then the last seven days. The plan is written by the AI from the exercise library (the engine
// when it can't); the first visit with no plan builds one from the profile. AT HOME / AT CENTER
// picks the programs and, before today's session starts, which place it is set up for.

type Load = { state: "loading" } | { state: "building" } | { state: "failed"; error: string } | { state: "ready"; home: Extract<WorkoutHome, { plan: object }>; history: HistoryDay[] };
type Programs = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; list: ProgramList };

const dotColor = (colors: Palette): Record<DayStatus, string | null> => ({
  missed: colors.danger,
  completed: colors.success,
  in_progress: colors.warning,
  planned: colors.creamLine,
  rest: null,
});

const pillColors = (colors: Palette): Record<Exclude<DayStatus, "rest">, { background: string; text: string }> => ({
  completed: { background: colors.successSoft, text: colors.success },
  in_progress: { background: colors.warningSoft, text: colors.ink },
  missed: { background: colors.dangerSoft, text: colors.ink },
  planned: { background: colors.surfaceAlt, text: colors.muted },
});

// A tapped day that asks before it changes anything: a missed one can move to today, and a
// later one can swap with today's session
type Prompt = { kind: "move" | "swap"; date: string };

const moon = { ios: "moon.stars.fill", android: "bedtime", web: "bedtime" } as const;

export default function WorkoutHub() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [showAll, setShowAll] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  // AT HOME / AT CENTER: the programs shown, AT HOME to start. Tapping one also sets today's
  // session up for that place when it hasn't started.
  const [place, setPlace] = useState<Place>("home");
  // The place today's session is being set up for, and why that failed
  const [placing, setPlacing] = useState<Place | null>(null);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [programs, setPrograms] = useState<Programs>({ state: "loading" });
  const [locationOpen, setLocationOpen] = useState(false);
  const latest = useRef(0);
  const latestPrograms = useRef(0);

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

  // The programs for the place (the starter catalog when the server can't be reached)
  const loadPrograms = useCallback(async (where: Place) => {
    const request = ++latestPrograms.current;
    const result = await fitnessApi.programs(await getToken().catch(() => null), where);
    if (request !== latestPrograms.current) return;
    setPrograms(result.ok ? { state: "ready", list: result.data } : { state: "failed", error: result.error });
  }, [getToken]);

  useEffect(() => {
    loadPrograms(place);
  }, [place, loadPrograms]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  // A pull reads the plan, the week, the last seven days and the programs again
  const reloadAll = useCallback(async () => {
    await Promise.all([refresh(), loadPrograms(place)]);
  }, [refresh, loadPrograms, place]);
  const { refreshControl } = usePullToRefresh(reloadAll);

  const retry = () => {
    setLoad({ state: "loading" });
    refresh();
  };
  const openDay = (date: string) => router.push({ pathname: "/workout/day", params: { date } });
  const openProgram = useCallback((program: ProgramCardData) => router.push({ pathname: "/fitness/[id]", params: { id: program.id } }), []);
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

  // Today's session set up for a place (adapted the first time), then the hub again
  const adaptToday = async (next: Place) => {
    const today = load.state === "ready" ? load.home.place : null;
    if (placing || !today || !today.canChange || today.current === next) return;
    setPlaceError(null);
    setPlacing(next);
    const result = await workoutApi.setPlace(await getToken().catch(() => null), todayIso(), next);
    if (!result.ok) setPlaceError(`${result.error.replace(/\.$/, "")}. The programs below are for ${next === "home" ? "home" : "the center"}.`);
    await refresh();
    setPlacing(null);
  };

  // AT HOME / AT CENTER: the programs for that place at once, and today's session for it too
  const pickPlace = (next: Place) => {
    if (placing) return;
    Haptics.selectionAsync().catch(() => {});
    setPlaceError(null);
    setPrograms({ state: "loading" });
    setPlace(next);
    adaptToday(next);
  };
  // Today's session is set up for the other place than the header shows
  const todayPlace = load.state === "ready" ? load.home.place : null;
  const elsewhere = !placing && todayPlace && todayPlace.current !== place ? todayPlace : null;

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <FitnessHeader place={place} switching={placing} onPlace={pickPlace} onLocation={() => setLocationOpen(true)} onSearch={() => router.push({ pathname: "/fitness/search", params: { place } })} />
        <ScrollView contentContainerStyle={{ paddingBottom: 140, gap: 20 }} showsVerticalScrollIndicator={false} refreshControl={refreshControl}>
          {/* Today's date and the plan's preferences (once there is a plan to change) */}
          <View className="flex-row items-center px-4">
            <View className="flex-1">
              <Text className="home__note" numberOfLines={1}>{longDate(todayIso())}</Text>
              <Text className="type-subhead text-forest-ink">Your plan</Text>
            </View>
            <IconButton icon={{ ios: "gearshape", android: "settings", web: "settings" }} label="Workout preferences" onPress={() => router.push("/workout/preferences")} disabled={load.state !== "ready"} />
          </View>
          {placing ? (
            <Text className="meta-text px-4 text-center">{`Setting today's session up for ${placing === "home" ? "home" : "the center"}…`}</Text>
          ) : placeError ? (
            <Text className="meta-text px-4 text-center" style={{ color: colors.danger }}>{placeError}</Text>
          ) : elsewhere ? (
            <View className="flex-row flex-wrap items-center justify-center gap-x-2 px-4">
              <Text className="meta-text">{`Today's session is set up for ${elsewhere.current === "home" ? "home" : "the center"}.`}</Text>
              {elsewhere.canChange && (
                <Pressable onPress={() => adaptToday(place)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Do today's session ${place === "home" ? "at home" : "at the center"}`}>
                  <Text className="home__link">{place === "home" ? "Do it at home" : "Do it at the center"}</Text>
                </Pressable>
              )}
            </View>
          ) : null}

          {load.state === "loading" || load.state === "building" ? (
            <View className="gap-3 px-4 pt-2">
              {load.state === "building" && <Text className="home__note text-center">Building your plan</Text>}
              <ScreenSkeleton cards={2} hero label={load.state === "building" ? "Building your plan" : "Loading your workout"} />
            </View>
          ) : load.state === "failed" ? (
            <View className="px-4">
              <DashedBlock
                icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }}
                title="Could not set up your plan"
                text={`${load.error.replace(/\.$/, "")}. Tap to try again.`}
                onPress={retry}
              />
            </View>
          ) : (
            <Ready
              home={load.home}
              history={load.history}
              showAll={showAll}
              onToggleAll={() => setShowAll((v) => !v)}
              openDay={openDay}
              ask={ask}
              programs={<ProgramSections programs={programs} onOpen={openProgram} onRetry={() => loadPrograms(place)} />}
            />
          )}
          {/* The programs still show when the plan can't load */}
          {load.state === "failed" && <ProgramSections programs={programs} onOpen={openProgram} onRetry={() => loadPrograms(place)} />}
        </ScrollView>
      </SafeAreaView>
      {locationOpen && <LocationSheet onClose={() => setLocationOpen(false)} onSaved={reloadAll} />}
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
  // The program sections, between the week and the history
  programs: ReactNode;
};

function Ready({ home, history, showAll, onToggleAll, openDay, ask, programs }: ReadyProps) {
  const colors = useThemeColors();
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
      <View className="gap-5 px-4">
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
            <Text className="meta-text">Nothing scheduled today. Recovery is part of the plan.</Text>
            <View className="workout__pill mt-1 self-start" style={{ backgroundColor: colors.successSoft }}>
              <Text className="workout__pill-label" style={{ color: colors.success }}>Rest · Recover · Be ready</Text>
            </View>
          </View>
          <SymbolView name={moon} size={52} tintColor={colors.leaf} />
        </View>
      )}

      {/* This week */}
      <View className="gap-3">
        <View className="flex-row items-baseline justify-between">
          <Text className="setup__section">This week</Text>
          <Text className="meta-text">{`${done} of ${scheduled} done`}</Text>
        </View>
        <View className="flex-row gap-1.5">
          {week.map(({ date, status: dayStatus }) => {
            const isToday = date === today;
            const dot = dotColor(colors)[dayStatus];
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

      </View>

      {programs}

      {/* History */}
      <View className="gap-3 px-4">
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
              const pill = pillColors(colors)[row.status];
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

// The six sections of programs for the place, one carousel each; a note when the server couldn't
// be reached (the starter catalog is shown, and opens once it's back)
function ProgramSections({ programs, onOpen, onRetry }: { programs: Programs; onOpen: (program: ProgramCardData) => void; onRetry: () => void }) {
  if (programs.state === "loading") {
    return (
      <View className="px-4">
        <ScreenSkeleton cards={2} label="Loading programs" />
      </View>
    );
  }
  if (programs.state === "failed") {
    return (
      <View className="px-4">
        <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load programs" text={`${programs.error.replace(/\.$/, "")}. Tap to try again.`} onPress={onRetry} />
      </View>
    );
  }
  return (
    <>
      {programs.list.offline && (
        <Pressable onPress={onRetry} className="px-4" accessibilityRole="button">
          <Text className="meta-text text-center">{"You're offline, so these are the programs saved in the app. Tap to try again."}</Text>
        </Pressable>
      )}
      {programs.list.sections.map((section) => (
        <FitnessCategorySection key={section.id} section={section} onOpen={onOpen} />
      ))}
    </>
  );
}

// The location button: what the member has at home and at their center. Today's session and the
// AT HOME / AT CENTER switch use it to adapt sessions to the equipment that's really there.
function LocationSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [home, setHome] = useState<HomeKit>("none");
  const [center, setCenter] = useState<CenterKit>("full_gym");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const result = await fitnessApi.equipment(await getToken().catch(() => null));
      if (!live) return;
      if (!result.ok) return setError(result.error);
      setEquipment(result.data);
      setHome(result.data.home);
      setCenter(result.data.center);
    })();
    return () => {
      live = false;
    };
  }, [getToken]);

  const save = async (dismiss: () => void) => {
    setSaving(true);
    setError(null);
    const result = await fitnessApi.saveEquipment(await getToken().catch(() => null), home, center);
    setSaving(false);
    if (!result.ok) return setError(result.error);
    onSaved();
    dismiss();
  };

  const Option = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => (
    <Pressable onPress={onPress} className={on ? "admin-chip admin-chip--on" : "admin-chip"} accessibilityRole="radio" accessibilityState={{ checked: on }}>
      <Text className={on ? "admin-segment__label admin-segment__label--on" : "admin-segment__label"}>{label}</Text>
    </Pressable>
  );

  return (
    <BottomSheet onClose={onClose}>
      {(dismiss) => (
        <View className="gap-4">
          <View className="gap-0.5">
            <Text className="type-headline text-forest-ink">Where you train</Text>
            <Text className="meta-text">Sessions adapt to the equipment you really have.</Text>
          </View>
          {!equipment && !error ? (
            <View className="items-center py-8"><ActivityIndicator color={colors.leaf} /></View>
          ) : equipment ? (
            <>
              <View className="gap-2">
                <View className="flex-row items-center gap-2">
                  <SymbolView name={{ ios: "house.fill", android: "home", web: "home" }} size={16} tintColor={colors.forestInk} />
                  <Text className="type-subhead text-forest-ink">At home</Text>
                </View>
                <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
                  {equipment.options.home.map((k) => <Option key={k} label={HOME_KIT_LABEL[k]} on={home === k} onPress={() => setHome(k)} />)}
                </View>
              </View>
              <View className="gap-2">
                <View className="flex-row items-center gap-2">
                  <SymbolView name={{ ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" }} size={16} tintColor={colors.forestInk} />
                  <Text className="type-subhead text-forest-ink">At your center</Text>
                </View>
                <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
                  {equipment.options.center.map((k) => <Option key={k} label={CENTER_KIT_LABEL[k]} on={center === k} onPress={() => setCenter(k)} />)}
                </View>
              </View>
            </>
          ) : null}
          {error && <Text className="meta-text" style={{ color: colors.danger }}>{error}</Text>}
          <Pressable onPress={() => save(dismiss)} disabled={saving || !equipment} className="btn-forest" style={{ opacity: saving || !equipment ? 0.6 : 1 }} accessibilityRole="button" accessibilityState={{ disabled: saving || !equipment }}>
            {saving ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Text className="btn-forest__label">Save</Text>}
          </Pressable>
        </View>
      )}
    </BottomSheet>
  );
}
