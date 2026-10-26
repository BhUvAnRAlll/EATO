import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { AuthImage } from "@/components/community/AuthImage";
import { Avatar } from "@/components/community/Avatar";
import { EmptyState, PostSkeleton } from "@/components/community/CommunityStates";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { FormAlert } from "@/components/FormAlert";
import { community } from "@/lib/community";
import { coachingModeLabels, connectButton, specialtyLabels } from "@/lib/trainerRules";
import { trainers, type TrainerDetail } from "@/lib/trainers";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

// A trainer's profile. The basics always show; the coaching approach, qualifications and
// languages unlock when the trainer accepts the member, and so does messaging. Connecting
// while another trainer is in place asks first, because it drops that trainer's plan.
export default function TrainerProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const getToken = useSessionToken();
  const [trainer, setTrainer] = useState<TrainerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"switch" | "cancel" | null>(null);

  const load = useCallback(async () => {
    const result = await trainers.get(await getToken(), id);
    if (result.ok) {
      setTrainer(result.data.trainer);
      setError(null);
    } else setError(result.error);
  }, [id, getToken]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(load, 0);
      return () => clearTimeout(timer);
    }, [load]),
  );

  const act = async (action: "connect" | "switch" | "cancel") => {
    setBusy(true);
    const token = await getToken();
    const result = action === "cancel" ? await trainers.endConnection(token) : await trainers.connect(token, id, action === "switch");
    setBusy(false);
    setConfirm(null);
    if (!result.ok) return setError(result.error);
    await load();
  };

  const message = async () => {
    const result = await community.openConversation(await getToken(), id);
    if (result.ok) router.push({ pathname: "/messages/[id]", params: { id: result.data.conversation.id } });
    else setError(result.error);
  };

  const button = trainer ? connectButton(trainer.connection, trainer.otherTrainer !== null, trainer.acceptingClients) : null;
  const onButton = () => {
    if (!button?.action) return;
    if (button.action === "connect") act("connect");
    else setConfirm(button.action);
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View className="h-12 flex-row items-center px-5">
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
          </Pressable>
          <Text className="type-subhead ml-3 flex-1 text-forest-ink" numberOfLines={1}>{trainer?.member.name ?? "Trainer"}</Text>
        </View>
        {!trainer ? (
          <View className="px-5 pt-4">{error ? <EmptyState icon={{ ios: "person.slash", android: "person_off", web: "person_off" }} title="Can't open this trainer" text={error} actionLabel="Retry" onAction={load} /> : <PostSkeleton />}</View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}>
            <View className="post__card items-center gap-2">
              {trainer.photoUrl ? <AuthImage path={trainer.photoUrl} style={{ width: 88, height: 88, borderRadius: 44 }} /> : <Avatar member={trainer.member} size={88} />}
              <Text className="type-headline text-forest-ink">{trainer.member.name}</Text>
              {trainer.verified && (
                <View className="flex-row items-center gap-1 rounded-pill bg-success-soft px-2.5 py-0.5" accessibilityLabel="Verified trainer">
                  <SymbolView name={{ ios: "checkmark.seal.fill", android: "verified", web: "verified" }} size={13} tintColor={colors.success} />
                  <Text className="post__time" style={{ color: colors.success, fontWeight: "700" }}>Verified</Text>
                </View>
              )}
              <Text className="post__time">{`${trainer.title} · ${trainer.yearsExperience} years`}</Text>
              <View className="mt-1 flex-row flex-wrap justify-center gap-2">
                {trainer.specialties.map((s) => (
                  <View key={s} className="rounded-pill bg-forest-soft px-3 py-1">
                    <Text className="post__time" style={{ color: colors.forestInk }}>{specialtyLabels[s]}</Text>
                  </View>
                ))}
              </View>
              {button && (
                <Pressable onPress={onButton} disabled={busy || !button.action} className={button.tone === "primary" ? "btn-forest mt-3 w-full" : "btn-outline mt-3 w-full"} style={{ opacity: busy ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel={button.action === "cancel" ? "Request sent. Tap to cancel it" : button.label}>
                  {busy ? <ActivityIndicator color={button.tone === "primary" ? colors.white : colors.forest} /> : <Text className={button.tone === "primary" ? "btn-forest__label" : "btn-outline__label"}>{button.label}</Text>}
                </Pressable>
              )}
              <Pressable onPress={message} disabled={trainer.messageLockReason !== null} className="admin__action mt-1 flex-row items-center gap-1.5" style={{ opacity: trainer.messageLockReason ? 0.5 : 1 }} accessibilityRole="button" accessibilityLabel={trainer.messageLockReason ? "Message, locked" : "Message"}>
                {trainer.messageLockReason && <SymbolView name={{ ios: "lock", android: "lock", web: "lock" }} size={12} tintColor={colors.muted} />}
                <Text className="admin__action-label">Message</Text>
              </Pressable>
              {trainer.messageLockReason && <Text className="home__note text-center">{trainer.messageLockReason}</Text>}
            </View>
            {error && <Pressable onPress={() => setError(null)}><FormAlert message={error} /></Pressable>}
            <View className="post__card gap-2">
              <Text className="setup__section">About</Text>
              <Text className="post__body">{trainer.bio}</Text>
              <Text className="home__note">{[coachingModeLabels[trainer.coachingMode], trainer.offersNutrition ? "Offers nutrition coaching" : "Training only", trainer.availability].filter(Boolean).join(" · ")}</Text>
            </View>
            {trainer.locked ? (
              <View className="post__card flex-row items-center gap-3">
                <SymbolView name={{ ios: "lock", android: "lock", web: "lock" }} size={18} tintColor={colors.muted} />
                <Text className="post__body flex-1">Full profile unlocks after acceptance: coaching approach, qualifications and languages.</Text>
              </View>
            ) : (
              <>
                {trainer.approach && (
                  <View className="post__card gap-2">
                    <Text className="setup__section">Coaching approach</Text>
                    <Text className="post__body">{trainer.approach}</Text>
                  </View>
                )}
                {(trainer.qualifications?.length ?? 0) > 0 && (
                  <View className="post__card gap-1">
                    <Text className="setup__section mb-1">Qualifications</Text>
                    {trainer.qualifications?.map((q) => <Text key={q} className="post__body">{`• ${q}`}</Text>)}
                  </View>
                )}
                {(trainer.languages?.length ?? 0) > 0 && (
                  <View className="post__card gap-1">
                    <Text className="setup__section mb-1">Languages</Text>
                    <Text className="post__body">{trainer.languages?.join(", ")}</Text>
                  </View>
                )}
              </>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
      <ConfirmSheet
        visible={confirm !== null}
        title={confirm === "switch" ? `Switch to ${trainer?.member.name.split(" ")[0] ?? "this trainer"}?` : "Cancel your request?"}
        text={confirm === "switch" ? "This ends your current trainer, and their diet plan, workout and recommended targets go with it. Your logged meals stay." : "You can send another request later."}
        confirmLabel={confirm === "switch" ? "Switch trainer" : "Cancel request"}
        busy={busy}
        onConfirm={() => confirm && act(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </View>
  );
}
