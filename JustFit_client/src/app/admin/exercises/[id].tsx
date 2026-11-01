import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { DashedBlock } from "@/components/macro/DashedBlock";
import { SymbolView } from "@/components/SymbolView";
import { adminExercises, DIFFICULTY_LABEL, MUSCLE_LABEL, type AdminExercise } from "@/lib/adminExercises";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; exercise: AdminExercise };

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/exercises"));

const SOURCE_LABEL: Record<AdminExercise["source"], string> = { built_in: "Built in", ai: "Added by AI", admin: "Added by an admin" };

// Super Admin › Exercises › one exercise: what members see about it (the steps, its details), its
// video state, and Archive (the engine stops giving it out; plans that have it keep it) or Restore.
// Uploading the video arrives with the next step, once the storage is chosen.
export default function ExerciseDetailScreen() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await adminExercises.detail(await getToken().catch(() => null), String(id));
    setLoad(result.ok ? { state: "ready", exercise: result.data } : { state: "failed", error: result.error });
  }, [getToken, id]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const setArchived = async (archived: boolean) => {
    setSaving(true);
    setError(null);
    const result = await adminExercises.setArchived(await getToken().catch(() => null), String(id), archived);
    setSaving(false);
    if (result.ok) setLoad({ state: "ready", exercise: result.data });
    else setError(result.error);
  };

  const confirmArchive = (e: AdminExercise) => {
    const text = `New workout plans won't include ${e.name}.${e.inUse > 0 ? ` The ${e.inUse} ${e.inUse === 1 ? "plan" : "plans"} that have it keep it.` : ""} You can restore it later.`;
    if (Platform.OS === "web") {
      if (window.confirm(text)) setArchived(true);
      return;
    }
    Alert.alert(`Archive ${e.name}?`, text, [
      { text: "Cancel", style: "cancel" },
      { text: "Archive", style: "destructive", onPress: () => setArchived(true) },
    ]);
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title" accessibilityRole="header">Exercise</Text>
          <View className="screen-bar__spacer" />
        </View>

        {load.state === "loading" ? (
          <View className="items-center gap-3 py-16">
            <ActivityIndicator color={colors.leaf} />
            <Text className="home__note">Loading</Text>
          </View>
        ) : load.state === "failed" ? (
          <View className="px-4">
            <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the exercise" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={() => { setLoad({ state: "loading" }); refresh(); }} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 16 }} showsVerticalScrollIndicator={false}>
            <View style={{ gap: 4 }}>
              <Text className="type-headline text-forest-ink">{load.exercise.name}</Text>
              <Text className="meta-text">{`${MUSCLE_LABEL[load.exercise.muscleGroup]} · ${load.exercise.equipment || "Bodyweight"} · ${DIFFICULTY_LABEL[load.exercise.difficulty]}`}</Text>
              <Text className="meta-text">{`${SOURCE_LABEL[load.exercise.source]}${load.exercise.archived ? " · Archived" : ""}${load.exercise.inUse > 0 ? ` · in ${load.exercise.inUse} members' plans` : ""}`}</Text>
            </View>

            <Text className="setup__section">Demo video</Text>
            <View className="admin-list" style={{ padding: 16, gap: 8 }}>
              <View className="flex-row items-center" style={{ gap: 10 }}>
                <SymbolView name={load.exercise.hasVideo ? { ios: "play.rectangle.fill", android: "smart_display", web: "smart_display" } : { ios: "video.slash", android: "videocam_off", web: "videocam_off" }} size={22} tintColor={load.exercise.hasVideo ? colors.success : colors.faint} />
                <Text className="card__title flex-1">{load.exercise.hasVideo ? "Video added" : "No video yet"}</Text>
              </View>
              <Text className="meta-text">
                {load.exercise.hasVideo
                  ? "Members see this video when the exercise is in their workout."
                  : "Until a video is added, members see the steps below. Uploading videos comes in the next update."}
              </Text>
            </View>

            <Text className="setup__section">Steps members see</Text>
            <View className="admin-list" style={{ padding: 16, gap: 8 }}>
              {load.exercise.instructions.length === 0 ? (
                <Text className="meta-text">No steps written for this exercise.</Text>
              ) : (
                load.exercise.instructions.map((line, i) => (
                  <View key={i} className="flex-row" style={{ gap: 8 }}>
                    <Text className="meta-text">{`${i + 1}.`}</Text>
                    <Text className="coach__meal-ings flex-1">{line}</Text>
                  </View>
                ))
              )}
            </View>

            <Text className="setup__section">Details</Text>
            <View className="admin-list" style={{ padding: 16, gap: 8 }}>
              {[
                ["Movement", load.exercise.pattern.replace(/_/g, " ")],
                ["Body region", load.exercise.region === "any" ? "Whole body" : load.exercise.region === "lower" ? "Lower body" : "Upper body"],
                ["Timed", load.exercise.timedSec ? `${load.exercise.timedSec} seconds` : "No, counted in reps"],
                ["Higher risk", load.exercise.highRisk ? "Yes (heavy loading or jumping)" : "No"],
                ["Joint friendly", load.exercise.lowImpact ? "Yes" : "No"],
                ["Machine or cable", load.exercise.machine ? "Yes" : "No"],
              ].map(([k, v]) => (
                <View key={k} className="ai-kv">
                  <Text className="ai-kv__key">{k}</Text>
                  <Text className="ai-kv__value">{v}</Text>
                </View>
              ))}
            </View>

            {error && <Text className="admin__hint" style={{ color: colors.danger }}>{error}</Text>}
            <Pressable
              onPress={() => (load.exercise.archived ? setArchived(false) : confirmArchive(load.exercise))}
              disabled={saving}
              className={load.exercise.archived ? "admin__action admin__action--primary self-center" : "admin__action admin__action--danger self-center"}
              accessibilityRole="button"
              accessibilityState={{ disabled: saving }}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.leaf} />
              ) : (
                <Text className={load.exercise.archived ? "admin__action-label admin__action-label--primary" : "admin__action-label admin__action-label--danger"}>
                  {load.exercise.archived ? "Restore exercise" : "Archive exercise"}
                </Text>
              )}
            </Pressable>
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}
