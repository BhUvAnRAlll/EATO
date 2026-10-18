import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router, useFocusEffect } from "expo-router";

import { EmptyState, PostSkeleton } from "@/components/community/CommunityStates";
import { FormAlert } from "@/components/FormAlert";
import { timeAgo } from "@/lib/community";
import { trainers, type MyRecommendation } from "@/lib/trainers";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

const sourceLabels = { calculated: "Personal (calculated)", user_adjusted: "Personal (set by you)", trainer_adjusted: "Trainer" } as const;

// Nutrition targets with a trainer: the active target and where it comes from, and the
// trainer's recommendation kept separately. It becomes active only when the member taps
// Apply; a newer one is marked New and never changes the active target by itself. "Use my
// personal targets" goes back to the target the member had before.
export default function TrainerTargetsScreen() {
  const getToken = useSessionToken();
  const [data, setData] = useState<MyRecommendation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"apply" | "restore" | null>(null);

  const load = useCallback(async () => {
    const result = await trainers.myRecommendation(await getToken());
    if (result.ok) setData(result.data);
    else setError(result.error);
  }, [getToken]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(load, 0);
      return () => clearTimeout(timer);
    }, [load]),
  );

  const run = async (action: "apply" | "restore") => {
    setBusy(action);
    setError(null);
    const token = await getToken();
    const result = action === "apply" ? await trainers.applyRecommendation(token) : await trainers.restoreTargets(token);
    setBusy(null);
    if (!result.ok) return setError(result.error);
    setData(result.data);
  };

  const targets = data?.targets.status === "ready" ? data.targets : null;
  const rec = data?.recommendation ?? null;
  const usingTrainer = targets?.source === "trainer_adjusted";

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View className="h-12 flex-row items-center px-5">
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
          </Pressable>
          <Text className="type-subhead ml-3 flex-1 text-forest-ink">Nutrition Targets</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}>
          {error && <Pressable onPress={() => setError(null)}><FormAlert message={error} /></Pressable>}
          {data === null ? (
            error ? null : <PostSkeleton />
          ) : !targets ? (
            <EmptyState icon={{ ios: "target", android: "track_changes", web: "track_changes" }} title="No targets yet" text="Finish your profile setup to get daily targets." />
          ) : (
            <>
              <View className="post__card gap-1">
                <Text className="post__time">{`Active · ${sourceLabels[targets.source]}`}</Text>
                <Text className="type-headline text-forest-ink">{`${targets.kcal} kcal`}</Text>
                <Text className="post__body">{`Protein ${targets.proteinG} g · Carbs ${targets.carbsG} g · Fat ${targets.fatG} g`}</Text>
              </View>
              {!rec ? (
                <EmptyState icon={{ ios: "person.crop.circle.badge.checkmark", android: "how_to_reg", web: "how_to_reg" }} title="No recommendation yet" text="When your trainer recommends targets, they show here. Your own targets stay until you choose." />
              ) : (
                <View className="post__card gap-2">
                  <View className="flex-row items-center gap-2">
                    <Text className="setup__section flex-1">Trainer Recommended Targets</Text>
                    {rec.isNew && (
                      <View className="rounded-pill bg-danger px-2 py-0.5">
                        <Text className="post__time" style={{ color: colors.white }}>New</Text>
                      </View>
                    )}
                  </View>
                  <Text className="post__time">{`From ${rec.trainer?.member.name ?? "your trainer"} · ${timeAgo(rec.createdAt)}`}</Text>
                  <Text className="post__author">{`${rec.calories} kcal · P ${rec.proteinG} g · C ${rec.carbsG} g · F ${rec.fatG} g`}</Text>
                  {rec.note && <Text className="post__body">{rec.note}</Text>}
                  {rec.isNew && (
                    <Pressable onPress={() => run("apply")} disabled={busy !== null} className="btn-forest mt-1" style={{ opacity: busy ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel={usingTrainer ? "Apply update" : "Use trainer targets"}>
                      {busy === "apply" ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">{usingTrainer ? "Apply update" : "Use trainer targets"}</Text>}
                    </Pressable>
                  )}
                  {!rec.isNew && !usingTrainer && (
                    <Pressable onPress={() => run("apply")} disabled={busy !== null} className="btn-outline mt-1" accessibilityRole="button" accessibilityLabel="Reset to trainer targets">
                      {busy === "apply" ? <ActivityIndicator color={colors.forest} /> : <Text className="btn-outline__label">Reset to Trainer Targets</Text>}
                    </Pressable>
                  )}
                </View>
              )}
              {usingTrainer && (
                <Pressable onPress={() => run("restore")} disabled={busy !== null} className="btn-outline" accessibilityRole="button" accessibilityLabel="Use my personal targets">
                  {busy === "restore" ? <ActivityIndicator color={colors.forest} /> : <Text className="btn-outline__label">Use my personal targets</Text>}
                </Pressable>
              )}
              <Text className="home__note text-center">{"A trainer's update never changes your active targets until you apply it."}</Text>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
