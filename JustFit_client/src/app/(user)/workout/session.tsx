import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useLocalSearchParams } from "expo-router";
import { useKeepAwake } from "expo-keep-awake";
import * as Haptics from "expo-haptics";

import { isValidIso, todayIso } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { weekOf, workoutApi, type TrainingDay } from "@/lib/workoutApi";
import { buildSteps, exerciseProgress, setKey, setTotals, startIndex } from "@/lib/workoutSteps";
import { useThemeColors } from "@/theme";
import { fonts } from "@/constants/fonts";
import { track } from "@/lib/analytics";
import { haptic } from "@/lib/haptics";

// The session player: today's session set by set, on the dark ink surface so it reads at arm's
// length with the phone propped against a rack. Every set of every exercise in plan order, with
// a rest after each. Each finished set is saved at once, so a dropped connection or a closed app
// loses at most the set in progress. Opened from the day with `date`, plus `exercise` to start
// partway in. The screen stays awake while it is open.

type Load =
  | { state: "loading" }
  | { state: "empty"; title: string; text: string | null }
  | { state: "ready"; day: TrainingDay; logId: string | null; completed: boolean; logged: Set<string> };

const icon = {
  back: { ios: "chevron.left", android: "arrow_back", web: "arrow_back" },
  restart: { ios: "arrow.counterclockwise", android: "restart_alt", web: "restart_alt" },
  pause: { ios: "pause.fill", android: "pause", web: "pause" },
  play: { ios: "play.fill", android: "play_arrow", web: "play_arrow" },
  check: { ios: "checkmark", android: "check", web: "check" },
  skip: { ios: "forward.end.fill", android: "skip_next", web: "skip_next" },
  minus: { ios: "minus", android: "remove", web: "remove" },
  plus: { ios: "plus", android: "add", web: "add" },
  close: { ios: "xmark", android: "close", web: "close" },
} as const;

export default function SessionPlayer() {
  const colors = useThemeColors();
  useKeepAwake();
  const params = useLocalSearchParams<{ date?: string; exercise?: string }>();
  const today = todayIso();
  const date = isValidIso(params.date) ? params.date : today;
  const getToken = useSessionToken();
  const insets = useSafeAreaInsets();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [error, setError] = useState<string | null>(null);
  // Start the session exactly once, even if this effect runs twice
  const started = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getToken().catch(() => null);
      const home = await workoutApi.home(token, date, weekOf(date), today);
      if (cancelled) return;
      if (!home.ok) return setLoad({ state: "empty", title: "Could not start the session", text: home.error });
      if (home.data.plan === null || !home.data.day) return setLoad({ state: "empty", title: "Nothing scheduled", text: null });
      if (date !== today) return setLoad({ state: "empty", title: "Nothing scheduled", text: "Only today's session can be started" });
      const day = home.data.day;
      const completed = home.data.status === "completed";
      let logId: string | null = null;
      if (!completed && !started.current) {
        started.current = true;
        const start = await workoutApi.startSession(token, date, today);
        if (cancelled) return;
        if (start.ok) {
          logId = start.data.log.id;
          if (start.data.created) track("workout_started");
        } else setError("Could not start the session");
      }
      const progress = await workoutApi.session(token, date, today);
      if (cancelled) return;
      if (progress.ok && progress.data.log && !logId && progress.data.log.status === "in_progress") logId = progress.data.log.id;
      const logged = new Set(progress.ok ? progress.data.sets.map((s) => setKey(s.dayExerciseId, s.setIndex)) : []);
      setLoad({ state: "ready", day, logId, completed, logged });
    })();
    return () => {
      cancelled = true;
    };
  }, [date, today, getToken]);

  const leave = () => (router.canGoBack() ? router.back() : router.replace({ pathname: "/workout/day", params: { date } }));

  return (
    <View className="player" style={{ paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 16) }}>
      <StatusBar hidden />
      {error && (
        <Pressable onPress={() => setError(null)} className="player__error absolute self-center" style={{ top: insets.top + 8, zIndex: 2 }} accessibilityRole="alert" accessibilityLabel={`${error}. Tap to dismiss`}>
          <Text className="player__error-label">{error}</Text>
          <SymbolView name={icon.close} size={12} tintColor={colors.ink} />
        </Pressable>
      )}
      {load.state === "loading" ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.white} />
        </View>
      ) : load.state === "empty" ? (
        <View className="player__column items-center justify-center">
          <Text className="player__name text-center">{load.title}</Text>
          {load.text && <Text className="player__caption text-center">{load.text}</Text>}
          <Pressable onPress={leave} className="player__button self-stretch" accessibilityRole="button" accessibilityLabel="Back">
            <Text className="player__button-label">Back</Text>
          </Pressable>
        </View>
      ) : (
        <Player
          key={load.day.id}
          day={load.day}
          logId={load.logId}
          completed={load.completed}
          initialLogged={load.logged}
          startExercise={params.exercise ?? null}
          getToken={getToken}
          onError={setError}
          onLeave={leave}
        />
      )}
    </View>
  );
}

type PlayerProps = {
  day: TrainingDay;
  logId: string | null;
  completed: boolean;
  initialLogged: Set<string>;
  startExercise: string | null;
  getToken: () => Promise<string | null>;
  onError: (message: string | null) => void;
  onLeave: () => void;
};

const MAX_REPS = 1000;
const MAX_WEIGHT = 1000;

function Player({ day, logId, completed, initialLogged, startExercise, getToken, onError, onLeave }: PlayerProps) {
  const colors = useThemeColors();
  const steps = useMemo(() => buildSteps(day.exercises), [day]);
  const [logged, setLogged] = useState(initialLogged);
  const [index, setIndex] = useState(() => (completed ? steps.length : startIndex(steps, initialLogged, startExercise)));
  const first = steps[index];
  const [remaining, setRemaining] = useState(first?.durationSec ?? 0);
  const [paused, setPaused] = useState(false);
  const [reps, setReps] = useState(first?.kind === "set" ? first.reps : 0);
  const [weight, setWeight] = useState(first?.kind === "set" && first.weightKg !== null ? String(first.weightKg) : "");
  const [finished, setFinished] = useState(completed);
  const [finishing, setFinishing] = useState(false);
  // Set saves run one after another, and finishing waits for them, so the last set is never
  // refused because the session closed first
  const saves = useRef<Promise<void>>(Promise.resolve());

  const step = steps[index] ?? null;
  const next = steps[index + 1] ?? null;

  // Arm a step: its countdown, and the prescription in the entry fields
  const goTo = (i: number) => {
    const s = steps[i];
    setIndex(i);
    setPaused(false);
    setRemaining(s?.durationSec ?? 0);
    setReps(s?.kind === "set" ? s.reps : 0);
    setWeight(s?.kind === "set" && s.weightKg !== null ? String(s.weightKg) : "");
  };

  const finish = async () => {
    if (finishing) return;
    if (!logId) return onError("Could not finish the session");
    setFinishing(true);
    await saves.current;
    const token = await getToken().catch(() => null);
    const result = await workoutApi.completeSession(token, logId);
    setFinishing(false);
    if (!result.ok) return onError("Could not finish the session");
    track("workout_completed");
    haptic.success();
    onError(null);
    setFinished(true);
  };

  const advanceTo = (i: number) => {
    if (i >= steps.length) {
      setIndex(steps.length);
      finish();
    } else goTo(i);
  };

  // A finished set: its duration when timed, else the reps (and weight) entered, saved at once
  const setDone = () => {
    if (!step || step.kind !== "set") return;
    let weightKg: number | undefined;
    if (step.durationSec === null && weight.trim() !== "") {
      const value = Number(weight.replace(",", "."));
      if (!Number.isFinite(value) || value < 0 || value > MAX_WEIGHT) return onError(`Weight must be between 0 and ${MAX_WEIGHT} kg.`);
      weightKg = Math.round(value * 10) / 10;
    }
    const key = setKey(step.exerciseId, step.setIndex);
    const entry = step.durationSec !== null ? { durationSec: step.durationSec } : { reps, ...(weightKg !== undefined ? { weightKg } : {}) };
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setLogged((prev) => new Set(prev).add(key));
    if (!logId) onError("Could not save that set");
    else {
      saves.current = saves.current.then(async () => {
        const token = await getToken().catch(() => null);
        const result = await workoutApi.logSet(token, { logId, dayExerciseId: step.exerciseId, setIndex: step.setIndex, ...entry });
        if (!result.ok) {
          setLogged((prev) => {
            const without = new Set(prev);
            without.delete(key);
            return without;
          });
          onError("Could not save that set");
        }
      });
    }
    advanceTo(index + 1);
  };

  // One tick a second while a timed step runs. Zero finishes a timed set or ends a rest.
  useEffect(() => {
    if (!step || step.durationSec === null || paused || finished || remaining <= 0) return;
    const timer = setTimeout(() => {
      if (remaining > 1) setRemaining(remaining - 1);
      else if (step.kind === "set") setDone();
      else advanceTo(index + 1);
    }, 1000);
    return () => clearTimeout(timer);
  });

  if (finished) {
    const totals = setTotals(steps, logged);
    return (
      <View className="player__column justify-center">
        <Text className="player__overline">Workout complete</Text>
        <Text className="player__figure" style={{ textAlign: "left", fontSize: 44, lineHeight: 52 }}>{`${totals.done} of ${totals.total} sets`}</Text>
        <Text className="player__title">Logged to today. Nice work.</Text>
        <Pressable onPress={onLeave} className="player__button mt-4" accessibilityRole="button" accessibilityLabel="Done">
          <Text className="player__button-label">Done</Text>
        </Pressable>
      </View>
    );
  }

  // Past the last step but not yet saved as finished (finishing, or it failed): offer it again
  if (!step) {
    return (
      <View className="player__column justify-center">
        <Text className="player__overline">Last set done</Text>
        <Text className="player__name">{day.title}</Text>
        <Pressable onPress={finish} disabled={finishing} className="player__button mt-4" style={{ opacity: finishing ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Finish workout">
          {finishing ? <ActivityIndicator color={colors.black} /> : <Text className="player__button-label">Finish workout</Text>}
        </Pressable>
      </View>
    );
  }

  const exercise = day.exercises[step.exerciseIndex];
  const timed = step.durationSec !== null;
  const progress = exerciseProgress(day.exercises, logged);
  const figure = timed ? (remaining >= 60 ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : String(remaining)) : String(reps);
  const unit = timed ? (remaining >= 60 ? "min" : "secs") : "reps";

  return (
    <View className="player__column">
      <View className="flex-row items-center justify-between">
        <Pressable onPress={onLeave} hitSlop={8} className="player__round" accessibilityRole="button" accessibilityLabel="Leave session">
          <SymbolView name={icon.back} size={18} tintColor={colors.white} />
        </Pressable>
      </View>

      <View className="flex-1 justify-center gap-6">
        <View className="gap-1">
          <Text className="player__overline">{step.kind === "rest" ? "Rest" : `Set ${step.setIndex + 1} of ${step.setCount}`}</Text>
          <Text className="player__name" numberOfLines={1}>{exercise.name}</Text>
        </View>

        {/* The timer row: restart, the big figure, then pause/play or "Set done" */}
        <View className="flex-row items-center justify-between">
          <Pressable onPress={() => goTo(index)} hitSlop={8} className="player__round" accessibilityRole="button" accessibilityLabel="Restart this set">
            <SymbolView name={icon.restart} size={18} tintColor={colors.white} />
          </Pressable>
          <View className="flex-1 items-center">
            <Text className="player__figure" accessibilityLabel={`${figure} ${unit}`}>{figure}</Text>
            <Text className="player__unit">{unit}</Text>
          </View>
          {timed || step.kind === "rest" ? (
            <Pressable onPress={() => setPaused((p) => !p)} hitSlop={8} className="player__round" accessibilityRole="button" accessibilityLabel={paused ? "Resume" : "Pause"}>
              <SymbolView name={paused ? icon.play : icon.pause} size={18} tintColor={colors.white} />
            </Pressable>
          ) : (
            <Pressable onPress={setDone} hitSlop={8} className="player__done" accessibilityRole="button" accessibilityLabel="Set done">
              <SymbolView name={icon.check} size={26} tintColor={colors.onPrimary} />
            </Pressable>
          )}
        </View>

        {/* What was actually lifted: reps prefilled from the plan, weight optional (never prescribed) */}
        {step.kind === "set" && !timed && (
          <View className="player__entry">
            <View className="player__entry-row">
              <Text className="player__title">Reps</Text>
              <View className="flex-row items-center gap-3">
                <Pressable onPress={() => setReps((r) => Math.max(0, r - 1))} className="player__step" accessibilityRole="button" accessibilityLabel="One rep fewer">
                  <SymbolView name={icon.minus} size={16} tintColor={colors.white} />
                </Pressable>
                <Pressable onPress={() => setReps((r) => Math.min(MAX_REPS, r + 1))} className="player__step" accessibilityRole="button" accessibilityLabel="One rep more">
                  <SymbolView name={icon.plus} size={16} tintColor={colors.white} />
                </Pressable>
              </View>
            </View>
            <View className="player__entry-row">
              <Text className="player__title">Weight</Text>
              <View className="flex-row items-center gap-2">
                <TextInput
                  value={weight}
                  onChangeText={setWeight}
                  keyboardType="decimal-pad"
                  maxLength={6}
                  placeholder="Optional"
                  placeholderTextColor="rgba(255,255,255,0.45)"
                  accessibilityLabel="Weight in kg (optional)"
                  style={{ width: 96, height: 40, paddingHorizontal: 12, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.14)", color: colors.white, fontSize: 16, fontFamily: fonts.semibold, textAlign: "right" }}
                />
                <Text className="player__caption">kg</Text>
              </View>
            </View>
          </View>
        )}
      </View>

      {/* Next up */}
      <View className="player__card">
        <View className="player__badge">
          {next === null ? (
            <SymbolView name={icon.check} size={20} tintColor={colors.white} />
          ) : (
            <Text className="player__badge-value">{next.kind === "rest" ? next.durationSec : next.setIndex + 1}</Text>
          )}
          <Text className="player__caption">{next === null ? "end" : next.kind === "rest" ? "secs" : `of ${next.setCount}`}</Text>
        </View>
        <View className="min-w-0 flex-1">
          <Text className="player__caption">Next up</Text>
          <Text className="player__title" numberOfLines={1}>{next === null ? "Finish" : next.kind === "rest" ? "Rest" : next.name}</Text>
        </View>
        <Pressable onPress={() => advanceTo(index + 1)} hitSlop={8} className="player__round" accessibilityRole="button" accessibilityLabel="Skip ahead">
          <SymbolView name={icon.skip} size={18} tintColor={colors.white} />
        </Pressable>
      </View>

      {/* One segment per exercise, filling as its sets are done */}
      <View className="flex-row gap-1" accessibilityLabel={`${setTotals(steps, logged).done} of ${setTotals(steps, logged).total} sets done`}>
        {progress.map((fraction, i) => (
          <View key={day.exercises[i].id} className="player__segment">
            <View style={{ width: `${Math.round(fraction * 100)}%`, height: "100%", backgroundColor: colors.primary }} />
          </View>
        ))}
      </View>
    </View>
  );
}
