import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect } from "expo-router";

import { usePullToRefresh } from "@/components/PullToRefresh";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { SymbolView } from "@/components/SymbolView";
import { adminExercises, MUSCLE_GROUPS, MUSCLE_LABEL, type ExerciseFilters, type ExerciseList, type MuscleGroup, type VideoFilter } from "@/lib/adminExercises";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; data: ExerciseList };

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/profile"));

const VIDEO_TABS: { id: VideoFilter; label: string }[] = [
  { id: "missing", label: "Needs video" },
  { id: "ready", label: "Has video" },
  { id: "all", label: "All" },
];

// Super Admin › Exercises: every exercise a member can be given, so the admin can film a demo
// video for each. Exercises without a video come first, the ones most members have in their plan
// first. Filter by video state and muscle group, search by name; Add with AI asks for new ones.
export default function ExercisesScreen() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [video, setVideo] = useState<VideoFilter>("missing");
  const [group, setGroup] = useState<MuscleGroup | null>(null);
  const [show, setShow] = useState<ExerciseFilters["show"]>("active");
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [load, setLoad] = useState<Load>({ state: "loading" });

  // The search applies a moment after typing stops
  useEffect(() => {
    const t = setTimeout(() => setSearch(typed.trim()), 350);
    return () => clearTimeout(t);
  }, [typed]);

  const refresh = useCallback(async () => {
    const result = await adminExercises.list(await getToken().catch(() => null), { search, group, video, show });
    setLoad(result.ok ? { state: "ready", data: result.data } : { state: "failed", error: result.error });
  }, [getToken, search, group, video, show]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );
  const { refreshControl } = usePullToRefresh(refresh);

  const counts = load.state === "ready" ? load.data.counts : null;
  const percent = counts && counts.total > 0 ? Math.round((counts.withVideo / counts.total) * 100) : 0;

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title" accessibilityRole="header">Exercises</Text>
          <View className="screen-bar__spacer" />
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"} refreshControl={refreshControl}>
          {counts && (
            <View className="admin-list" style={{ padding: 16, gap: 8 }} accessibilityLabel={`${counts.withVideo} of ${counts.total} exercises have a video`}>
              <View className="ai-kv">
                <Text className="card__title">{`${counts.withVideo} of ${counts.total} have a video`}</Text>
                <Text className="ai-kv__value">{`${percent}%`}</Text>
              </View>
              <View className="ai-bar"><View className="ai-bar__fill" style={{ width: `${percent}%` }} /></View>
              <Text className="meta-text">{`${counts.total - counts.withVideo} still need one${counts.ai > 0 ? ` · ${counts.ai} added by AI` : ""}`}</Text>
            </View>
          )}

          <Pressable onPress={() => router.push("/admin/exercises/add")} className="btn-forest flex-row items-center justify-center" style={{ gap: 8 }} accessibilityRole="button" accessibilityLabel="Add exercises with AI">
            <SymbolView name={{ ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }} size={16} tintColor={colors.onPrimary} />
            <Text className="btn-forest__label">Add with AI</Text>
          </Pressable>

          <TextInput value={typed} onChangeText={setTyped} placeholder="Search exercises" placeholderTextColor={colors.faint} className="admin__input" accessibilityLabel="Search exercises" autoCapitalize="none" autoCorrect={false} />

          <View className="flex-row" style={{ gap: 8 }} accessibilityRole="tablist">
            {VIDEO_TABS.map((t) => (
              <Pressable key={t.id} onPress={() => { setVideo(t.id); setLoad({ state: "loading" }); }} className={video === t.id ? "admin-segment admin-segment--on" : "admin-segment"} accessibilityRole="tab" accessibilityState={{ selected: video === t.id }}>
                <Text className={video === t.id ? "admin-segment__label admin-segment__label--on" : "admin-segment__label"}>{t.label}</Text>
              </Pressable>
            ))}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {[null, ...MUSCLE_GROUPS].map((g) => (
              <Pressable key={g ?? "all"} onPress={() => { setGroup(g); setLoad({ state: "loading" }); }} className={group === g ? "admin-chip admin-chip--on" : "admin-chip"} accessibilityRole="button" accessibilityState={{ selected: group === g }} accessibilityLabel={g ? `Only ${MUSCLE_LABEL[g]}` : "Every muscle group"}>
                <Text className={group === g ? "admin-segment__label admin-segment__label--on" : "admin-segment__label"}>{g ? MUSCLE_LABEL[g] : "All groups"}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {load.state === "loading" ? (
            <View className="items-center gap-3 py-16">
              <ActivityIndicator color={colors.leaf} />
              <Text className="home__note">Loading</Text>
            </View>
          ) : load.state === "failed" ? (
            <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load exercises" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={() => { setLoad({ state: "loading" }); refresh(); }} />
          ) : load.data.exercises.length === 0 ? (
            <DashedBlock
              icon={{ ios: "figure.strengthtraining.traditional", android: "fitness_center", web: "fitness_center" }}
              title={video === "missing" && !search && !group && show === "active" ? "Every exercise has a video" : "No exercises found"}
              text={search ? `Nothing matches "${search}".` : "Try another filter."}
            />
          ) : (
            <>
              <Text className="home__note">{`${load.data.exercises.length} ${load.data.exercises.length === 1 ? "exercise" : "exercises"}`}</Text>
              <View className="admin-list">
                {load.data.exercises.map((e, i) => (
                  <Pressable
                    key={e.id}
                    onPress={() => router.push({ pathname: "/admin/exercises/[id]", params: { id: e.id } })}
                    className={i > 0 ? "admin-row admin-row--divided" : "admin-row"}
                    accessibilityRole="button"
                    accessibilityLabel={`${e.name}, ${MUSCLE_LABEL[e.muscleGroup]}, ${e.hasVideo ? "has a video" : "needs a video"}${e.inUse > 0 ? `, in ${e.inUse} members' plans` : ""}${e.source === "ai" ? ", added by AI" : ""}`}
                  >
                    <View className="admin-row__icon">
                      <SymbolView name={e.hasVideo ? { ios: "play.rectangle.fill", android: "smart_display", web: "smart_display" } : { ios: "video.slash", android: "videocam_off", web: "videocam_off" }} size={18} tintColor={e.hasVideo ? colors.success : colors.faint} />
                    </View>
                    <View className="min-w-0 flex-1" style={{ gap: 2 }}>
                      <Text className="card__title" numberOfLines={1}>{e.name}</Text>
                      <Text className="meta-text" numberOfLines={1}>{`${MUSCLE_LABEL[e.muscleGroup]} · ${e.equipment || "Bodyweight"}${e.inUse > 0 ? ` · in ${e.inUse} ${e.inUse === 1 ? "plan" : "plans"}` : ""}`}</Text>
                    </View>
                    {e.source === "ai" && (
                      <View className="badge badge--booked"><Text className="badge__label badge__label--booked">AI</Text></View>
                    )}
                    <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {counts && (counts.archived > 0 || show === "archived") && (
            <Pressable onPress={() => { setShow(show === "active" ? "archived" : "active"); setLoad({ state: "loading" }); }} className="admin__action self-center" accessibilityRole="button">
              <Text className="admin__action-label">{show === "active" ? `Show archived (${counts.archived})` : "Back to active exercises"}</Text>
            </Pressable>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
