import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { IconButton } from "@/components/IconButton";
import { PressableScale } from "@/components/PressableScale";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { ProgramArt } from "@/components/fitness/ProgramArt";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { fitnessApi, LEVEL_TEXT, programMeta, type ProgramDetail, type ProgramExercise, type ProgramSession } from "@/lib/fitnessApi";
import { todayIso } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; program: ProgramDetail };

const back = () => (router.canGoBack() ? router.back() : router.replace("/workout"));
const SECTION_LABEL = { warmup: "Warm-up", workout: "Workout", cooldown: "Cool-down" } as const;

// "3 x 12", "2 x 40s"
function setsLabel(e: ProgramExercise) {
  const first = e.sets[0];
  if (!first) return "";
  if (first.durationSec !== undefined) return `${e.sets.length} x ${first.durationSec}s`;
  const reps = e.repsMin && e.repsMax && e.repsMin !== e.repsMax ? `${e.repsMin}-${e.repsMax}` : String(first.reps ?? e.repsMax ?? "");
  return `${e.sets.length} x ${reps}`;
}

function SessionCard({ session, index, busy, onStart }: { session: ProgramSession; index: number; busy: boolean; onStart: () => void }) {
  const colors = useThemeColors();
  const sections = (["warmup", "workout", "cooldown"] as const).map((s) => ({ id: s, items: session.exercises.filter((e) => e.section === s) })).filter((s) => s.items.length > 0);
  return (
    <View className="fitness-session">
      <View className="flex-row items-start gap-3">
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="type-overline text-muted">{`Session ${index + 1}`}</Text>
          <Text className="type-subhead text-forest-ink">{session.title}</Text>
          <Text className="meta-text">{`${session.minutes} min · ${session.exerciseCount} exercises`}</Text>
        </View>
      </View>
      {sections.map((s) => (
        <View key={s.id} className="gap-1.5">
          <Text className="type-caption text-muted">{SECTION_LABEL[s.id]}</Text>
          {s.items.map((e, i) => (
            <View key={`${e.name}-${i}`} className="flex-row items-center gap-2">
              <SymbolView name={e.hasVideo ? { ios: "play.circle.fill", android: "play_circle", web: "play_circle" } : { ios: "circle.fill", android: "circle", web: "circle" }} size={e.hasVideo ? 14 : 6} tintColor={e.hasVideo ? colors.leaf : colors.faint} />
              <Text className="min-w-0 flex-1 text-forest-ink" style={{ fontSize: 14 }} numberOfLines={1}>{e.name}</Text>
              <Text className="meta-text">{setsLabel(e)}</Text>
            </View>
          ))}
        </View>
      ))}
      <PressableScale onPress={onStart} disabled={busy} className="btn-forest flex-row items-center justify-center" style={{ gap: 8, opacity: busy ? 0.7 : 1 }} accessibilityRole="button" accessibilityLabel={`Do ${session.title} today`} accessibilityState={{ disabled: busy }}>
        {busy ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <SymbolView name={{ ios: "play.fill", android: "play_arrow", web: "play_arrow" }} size={14} tintColor={colors.onPrimary} />}
        <Text className="btn-forest__label">Do this today</Text>
      </PressableScale>
    </View>
  );
}

// A Fitness program: its art, what it is, who it's for, and every session with its exercises.
// "Do this today" makes the session today's workout and opens it on the day screen, where the
// usual Start runs the session player. Every program is free.
export default function ProgramScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const getToken = useSessionToken();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await fitnessApi.program(await getToken().catch(() => null), String(id));
    setLoad(result.ok ? { state: "ready", program: result.data } : { state: "failed", error: result.error });
  }, [getToken, id]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const start = async (program: ProgramDetail, session: ProgramSession) => {
    if (starting) return;
    setStarting(session.id);
    setError(null);
    const today = todayIso();
    const result = await fitnessApi.startToday(await getToken().catch(() => null), program.id, session.id, today);
    setStarting(null);
    if (!result.ok) return setError(result.error);
    router.push({ pathname: "/workout/day", params: { date: today } });
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style={load.state === "ready" ? "light" : "auto"} />
      {load.state === "loading" ? (
        <View className="px-4" style={{ paddingTop: insets.top + 56 }}>
          <ScreenSkeleton cards={2} hero label="Loading the program" />
        </View>
      ) : load.state === "failed" ? (
        <View className="px-4" style={{ paddingTop: insets.top + 56 }}>
          <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not open the program" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={() => { setLoad({ state: "loading" }); refresh(); }} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
          <View style={{ height: 280 + insets.top }} className="overflow-hidden">
            <ProgramArt palette={load.program.palette} icon={load.program.icon} iconSize={96} id={`detail-${load.program.id}`} />
            <View className="absolute bottom-5 left-4 right-4 gap-1">
              <View className="flex-row gap-2">
                <View className="fitness-card__pill" style={{ position: "relative", left: 0, top: 0 }}>
                  <Text className="workout__chip-label">{LEVEL_TEXT[load.program.level]}</Text>
                </View>
                <View className="fitness-card__pill" style={{ position: "relative", left: 0, top: 0 }}>
                  <Text className="workout__chip-label">Free</Text>
                </View>
              </View>
              <Text className="fitness-card__title" style={{ fontSize: 28, lineHeight: 34 }} accessibilityRole="header">{load.program.title}</Text>
              <Text className="fitness-card__meta" style={{ fontSize: 14, lineHeight: 20 }}>{load.program.subtitle}</Text>
            </View>
          </View>

          <View className="gap-4 px-4 pt-5">
            <Text className="meta-text">{programMeta(load.program)}{load.program.place === "both" ? " · Home or center" : load.program.place === "home" ? " · At home" : " · At the center"}</Text>
            {load.program.description ? <Text className="text-forest-ink" style={{ fontSize: 15, lineHeight: 23 }}>{load.program.description}</Text> : null}
            {error && <Text className="meta-text" style={{ color: colors.danger }}>{error}</Text>}
            <Text className="setup__section">Sessions</Text>
            {load.program.sessions.map((s, i) => (
              <SessionCard key={s.id} session={s} index={i} busy={starting === s.id} onStart={() => start(load.program, s)} />
            ))}
          </View>
        </ScrollView>
      )}
      <View className="absolute left-4" style={{ top: insets.top + 8 }}>
        <IconButton icon={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} label="Back" onPress={back} />
      </View>
    </View>
  );
}
