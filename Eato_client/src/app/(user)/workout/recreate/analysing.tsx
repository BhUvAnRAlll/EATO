import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router } from "expo-router";
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";

import { RoundButton, leaveRecreate } from "@/components/workout/RecreateFrame";
import { useRecreateDraft } from "@/components/workout/RecreateDraft";
import { todayIso } from "@/lib/macro";
import { toAnswers } from "@/lib/recreateRules";
import { useSessionToken } from "@/lib/session";
import { workoutApi } from "@/lib/workoutApi";
import { colors } from "@/theme";

// Rebuild my plan: "Creating your plan". The stages are paced (about 650 ms each) against the
// real save: the screen walks through stage five, waits for the server, then ticks the last
// stage and replaces itself with the reveal. The save is sent exactly once (a second one would
// make two plans). There is no AI here: the engine is plain arithmetic.

const STAGES = [
  ["Analysing user inputs", "Understanding your goals and preferences"],
  ["Calibrating workout intensity", "Matching the right challenge for you"],
  ["Building workout split", "Structuring your training days"],
  ["Selecting exercises", "Choosing the best movements for your goal"],
  ["Balancing training volume", "Fine-tuning for the best results"],
  ["Finalising your plan", "Almost there…"],
];
const STAGE_MS = 650;

export default function RecreateAnalysing() {
  const insets = useSafeAreaInsets();
  const getToken = useSessionToken();
  const { draft } = useRecreateDraft();
  const [done, setDone] = useState(0); // stages completed
  const [saved, setSaved] = useState<"pending" | "ok" | { error: string }>("pending");
  const sent = useRef(false);

  // The one save
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    (async () => {
      const answers = toAnswers(draft);
      if (!answers) return setSaved({ error: "We couldn't create your plan" });
      const result = await workoutApi.recreatePlan(await getToken().catch(() => null), todayIso(), answers);
      setSaved(result.ok ? "ok" : { error: result.error || "We couldn't create your plan" });
    })();
  }, [draft, getToken]);

  // The pacing: up to stage five on the clock, the last one only once the plan is saved
  useEffect(() => {
    if (typeof saved === "object") return;
    if (done < STAGES.length - 1) {
      const timer = setTimeout(() => setDone((n) => n + 1), STAGE_MS);
      return () => clearTimeout(timer);
    }
    if (saved === "ok") {
      const timer = setTimeout(() => (done < STAGES.length ? setDone(STAGES.length) : router.replace("/workout/recreate/reveal")), done < STAGES.length ? 300 : 500);
      return () => clearTimeout(timer);
    }
  }, [done, saved]);

  const failed = typeof saved === "object";
  const percent = Math.round((done / STAGES.length) * 100);

  return (
    <View className="flex-1 bg-cream" style={{ paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 16) }}>
      <StatusBar style="dark" />
      <View className="flex-row justify-end px-5">
        <RoundButton icon={{ ios: "xmark", android: "close", web: "close" }} label="Close" onPress={leaveRecreate} />
      </View>
      <View className="flex-1 gap-5 px-5 pt-2">
        <View className="items-center gap-3">
          <Ring failed={failed} />
          <Text className="type-title text-center text-forest-ink">{failed ? "Something went wrong" : "Creating your plan"}</Text>
          <Text className="home__note text-center">{failed ? saved.error : "Built from your answers by JustFit's workout engine."}</Text>
        </View>

        {!failed && (
          <>
            <View className="home__card gap-3">
              {STAGES.map(([title, text], i) => {
                const complete = i < done;
                const running = i === done;
                return (
                  <View key={title} className="flex-row items-center gap-3" accessibilityLabel={`${title}: ${complete ? "Completed" : running ? "In progress" : "Waiting"}`}>
                    <View className={complete ? "recreate__stage recreate__stage--done" : "recreate__stage"}>
                      {complete && <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={11} tintColor={colors.white} />}
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="card__title" style={{ opacity: complete || running ? 1 : 0.45 }}>{title}</Text>
                      <Text className="post__time" numberOfLines={1}>{text}</Text>
                    </View>
                    {(complete || running) && <Text className="post__time">{complete ? "Completed" : "In progress"}</Text>}
                  </View>
                );
              })}
            </View>
            <View className="gap-1.5">
              <View className="h-2 overflow-hidden rounded-full bg-cream-tab">
                <View className="h-2 rounded-full" style={{ width: `${percent}%`, backgroundColor: colors.leaf }} />
              </View>
              <Text className="post__time text-right">{`${percent}%`}</Text>
            </View>
            <View className="home__card gap-0.5">
              <Text className="card__title">· Good things take a moment</Text>
              <Text className="post__time">A better, stronger you is on the way.</Text>
            </View>
            <View className="flex-row justify-center gap-2">
              {["Personalized", "Balanced", "Effective"].map((chip) => (
                <View key={chip} className="workout__pill" style={{ backgroundColor: colors.forestSoft }}>
                  <Text className="workout__pill-label" style={{ color: colors.forestInk }}>{chip}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </View>
      {failed && (
        <View className="px-5">
          <Pressable onPress={() => router.back()} className="btn-forest" accessibilityRole="button" accessibilityLabel="Back to review">
            <Text className="btn-forest__label">Back to review</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// A 140 pt ring with a turning arc and a pulsing dumbbell; red and still when it failed
function Ring({ failed }: { failed: boolean }) {
  const turn = useSharedValue(0);
  const pulse = useSharedValue(1);
  useEffect(() => {
    turn.set(withRepeat(withTiming(360, { duration: 1200, easing: Easing.linear, reduceMotion: ReduceMotion.System }), -1));
    pulse.set(withRepeat(withSequence(withTiming(1.12, { duration: 500, reduceMotion: ReduceMotion.System }), withTiming(1, { duration: 500, reduceMotion: ReduceMotion.System })), -1));
  }, [turn, pulse]);
  const arc = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get()}deg` }] }));
  const icon = useAnimatedStyle(() => ({ transform: [{ scale: pulse.get() }] }));
  const tint = failed ? colors.danger : colors.leaf;
  return (
    <View style={{ width: 140, height: 140, alignItems: "center", justifyContent: "center" }}>
      <View style={{ position: "absolute", width: 140, height: 140, borderRadius: 70, borderWidth: 8, borderColor: failed ? colors.danger : colors.creamTab }} />
      {!failed && (
        <Animated.View style={[{ position: "absolute", width: 140, height: 140, borderRadius: 70, borderWidth: 8, borderColor: "transparent", borderTopColor: tint, borderRightColor: tint }, arc]} />
      )}
      <Animated.View style={failed ? undefined : icon}>
        <SymbolView name={failed ? { ios: "exclamationmark", android: "priority_high", web: "priority_high" } : { ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" }} size={44} tintColor={tint} />
      </Animated.View>
    </View>
  );
}
