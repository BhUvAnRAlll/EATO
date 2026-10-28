import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect } from "expo-router";

import { AuthImage } from "@/components/community/AuthImage";
import { Avatar } from "@/components/community/Avatar";
import { EmptyState, PostSkeleton } from "@/components/community/CommunityStates";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { FormAlert } from "@/components/FormAlert";
import { community, timeAgo } from "@/lib/community";
import { trainers, type MyConnection } from "@/lib/trainers";
import { useSessionToken } from "@/lib/session";
import type { Icon } from "@/types/profile";
import { colors } from "@/theme";

// My Trainer: who coaches me, since when, what they've shared (diet plan, workout, targets),
// a chat with them, and Disconnect. Disconnecting removes the plan, the workout and the
// recommendation; if the trainer's targets were in use, the member's own come back. Logged
// meals stay in the diary.
export default function MyTrainerScreen() {
  const getToken = useSessionToken();
  const [mine, setMine] = useState<MyConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await trainers.myConnection(await getToken());
    if (result.ok) setMine(result.data);
    else setError(result.error);
  }, [getToken]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(load, 0);
      return () => clearTimeout(timer);
    }, [load]),
  );

  const disconnect = async () => {
    setBusy(true);
    const result = await trainers.endConnection(await getToken());
    setBusy(false);
    setConfirming(false);
    if (!result.ok) return setError(result.error);
    setMine(result.data);
  };

  const message = async () => {
    if (mine?.state !== "connected") return;
    const result = await community.openConversation(await getToken(), mine.trainer.member.id);
    if (result.ok) router.push({ pathname: "/messages/[id]", params: { id: result.data.conversation.id } });
    else setError(result.error);
  };

  const shortcut = (label: string, detail: string, icon: Icon, onPress: () => void, isNew = false) => (
    <Pressable key={label} onPress={onPress} className="post__card flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel={isNew ? `${label}, new` : label}>
      <View className="group__tile">
        <SymbolView name={icon} size={20} tintColor={colors.leaf} />
      </View>
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="post__author">{label}</Text>
          {isNew && (
            <View className="rounded-pill bg-danger px-2 py-0.5">
              <Text className="post__time" style={{ color: colors.white }}>New</Text>
            </View>
          )}
        </View>
        <Text className="post__time" numberOfLines={1}>{detail}</Text>
      </View>
      <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={16} tintColor={colors.muted} />
    </Pressable>
  );

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View className="screen-bar">
          <Pressable onPress={() => router.back()} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title" numberOfLines={1}>My Trainer</Text>
          <View className="screen-bar__spacer" />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
          {error && <Pressable onPress={() => setError(null)}><FormAlert message={error} /></Pressable>}
          {mine === null ? (
            <PostSkeleton />
          ) : mine.state !== "connected" ? (
            <EmptyState
              icon={{ ios: "figure.strengthtraining.traditional", android: "fitness_center", web: "fitness_center" }}
              title={mine.state === "requested" ? "Request sent" : "No trainer yet"}
              text={mine.state === "requested" ? mine.messageLockReason : "Find a trainer in Community → Trainers."}
              actionLabel="Find Trainers"
              onAction={() => router.back()}
            />
          ) : (
            <>
              <Pressable onPress={() => router.push({ pathname: "/community/trainers/[id]", params: { id: mine.trainer.member.id } })} className="post__card flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel={`Open ${mine.trainer.member.name}'s profile`}>
                {mine.trainer.photoUrl ? <AuthImage path={mine.trainer.photoUrl} style={{ width: 56, height: 56, borderRadius: 28 }} /> : <Avatar member={mine.trainer.member} size={56} />}
                <View className="flex-1">
                  <Text className="post__author">{mine.trainer.member.name}</Text>
                  <Text className="post__time">{mine.trainer.title}</Text>
                  <Text className="home__note">Connected {timeAgo(mine.connectedAt)}</Text>
                </View>
              </Pressable>
              {mine.workout?.note && (
                <View className="setup__info">
                  <SymbolView name={{ ios: "text.bubble", android: "chat", web: "chat" }} size={16} tintColor={colors.forest} />
                  <Text className="setup__card-text flex-1">{`Latest change from ${mine.trainer.member.name.split(" ")[0]}: ${mine.workout.note}`}</Text>
                </View>
              )}
              {mine.trainer.offersNutrition && shortcut("Diet Plan", mine.dietPlan ? `${mine.dietPlan.name} · updated ${timeAgo(mine.dietPlan.updatedAt)}` : "Not shared yet", { ios: "fork.knife", android: "restaurant", web: "restaurant" }, () => router.push("/community/trainers/plan"))}
              {shortcut("Workout", mine.workout ? `${mine.workout.name} · updated ${timeAgo(mine.workout.updatedAt)}` : "Not shared yet: your own plan is in use", { ios: "dumbbell", android: "fitness_center", web: "fitness_center" }, () => router.push("/workout"))}
              {mine.trainer.offersNutrition && shortcut("Nutrition Targets", mine.recommendation ? (mine.recommendation.isNew ? "A new recommendation is waiting" : "Recommendation reviewed") : "No recommendation yet", { ios: "target", android: "track_changes", web: "track_changes" }, () => router.push("/community/trainers/targets"), mine.recommendation?.isNew ?? false)}
              {shortcut("Message Trainer", "Chat about your plan", { ios: "bubble.left", android: "chat_bubble_outline", web: "chat_bubble_outline" }, message)}
              <Pressable onPress={() => setConfirming(true)} className="btn-outline mt-4" accessibilityRole="button" accessibilityLabel="Disconnect trainer">
                {busy ? <ActivityIndicator color={colors.forest} /> : <Text className="btn-outline__label" style={{ color: colors.danger }}>Disconnect trainer</Text>}
              </Pressable>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
      <ConfirmSheet
        visible={confirming}
        title="Disconnect your trainer?"
        text="Their diet plan, workout and recommended targets are removed. If you were using their targets, your own come back. Your logged meals stay."
        confirmLabel="Disconnect"
        busy={busy}
        onConfirm={disconnect}
        onCancel={() => setConfirming(false)}
      />
    </View>
  );
}
