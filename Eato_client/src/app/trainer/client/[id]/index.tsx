import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { AdminScreen } from "@/components/admin/AdminScreen";
import { Avatar } from "@/components/community/Avatar";
import { EmptyState, PostSkeleton } from "@/components/community/CommunityStates";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { FormAlert } from "@/components/FormAlert";
import { community, timeAgo } from "@/lib/community";
import { macroKcal, macrosRoughlyMatch, planGoalLabels } from "@/lib/trainerRules";
import { trainers, type ClientDetail } from "@/lib/trainers";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

const input = { height: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.creamLine, backgroundColor: colors.white, paddingHorizontal: 12, fontSize: 15, color: colors.forestInk } as const;

// One client, as their trainer sees them: setup basics and current targets, the recommended
// targets (the member applies them from their side), the diet plan and workout editors, a
// chat, and ending the coaching. The server checks this trainer coaches them on every call.
export default function TrainerClientScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const getToken = useSessionToken();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rec, setRec] = useState({ calories: "", proteinG: "", carbsG: "", fatG: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [ending, setEnding] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const load = useCallback(async () => {
    const result = await trainers.client(await getToken(), id);
    if (!result.ok) return setError(result.error);
    setClient(result.data.client);
    const r = result.data.client.recommendation ?? (result.data.client.targets ? { calories: result.data.client.targets.kcal, ...result.data.client.targets, note: null } : null);
    if (r) setRec((current) => (current.calories ? current : { calories: String(r.calories), proteinG: String(r.proteinG), carbsG: String(r.carbsG), fatG: String(r.fatG), note: r.note ?? "" }));
  }, [id, getToken]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(load, 0);
      return () => clearTimeout(timer);
    }, [load]),
  );

  const numbers = { calories: Number(rec.calories), proteinG: Number(rec.proteinG), carbsG: Number(rec.carbsG), fatG: Number(rec.fatG) };
  const valid = Object.values(numbers).every((n) => Number.isInteger(n) && n >= 0) && numbers.calories >= 800 && numbers.calories <= 6000;

  const saveRecommendation = async () => {
    if (!valid) return setError("Calories 800–6000 and whole grams for protein, carbs and fat.");
    setSaving(true);
    setError(null);
    const result = await trainers.setRecommendation(await getToken(), id, { ...numbers, note: rec.note.trim() || null });
    setSaving(false);
    if (!result.ok) return setError(result.error);
    setNotice("Sent. It shows as New for your client; their targets change only when they apply it.");
    await load();
  };

  const message = async () => {
    const result = await community.openConversation(await getToken(), id);
    if (result.ok) router.push({ pathname: "/trainer/messages/[id]", params: { id: result.data.conversation.id } });
    else setError(result.error);
  };

  const endCoaching = async () => {
    setEnding(true);
    const result = await trainers.endClient(await getToken(), id);
    setEnding(false);
    setConfirmEnd(false);
    if (!result.ok) return setError(result.error);
    router.back();
  };

  if (!client) {
    return (
      <AdminScreen title="Client">
        {error ? <EmptyState icon={{ ios: "person.slash", android: "person_off", web: "person_off" }} title="Can't open this client" text={error} actionLabel="Retry" onAction={load} /> : <PostSkeleton />}
      </AdminScreen>
    );
  }

  const field = (key: "calories" | "proteinG" | "carbsG" | "fatG", label: string) => (
    <View className="min-w-0 flex-1">
      <Text className="post__time mb-1">{label}</Text>
      <TextInput value={rec[key]} onChangeText={(v) => setRec((r) => ({ ...r, [key]: v.replace(/[^0-9]/g, "") }))} keyboardType="number-pad" maxLength={4} accessibilityLabel={label} style={input} />
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
    <AdminScreen title={client.member.name}>
      <View className="gap-3">
        {error && <Pressable onPress={() => setError(null)}><FormAlert message={error} /></Pressable>}
        {notice && <Text className="home__note">{notice}</Text>}
        <View className="post__card flex-row items-center gap-3">
          <Avatar member={client.member} size={52} />
          <View className="flex-1">
            <Text className="post__author">{client.member.name}</Text>
            <Text className="post__time">{[client.goal?.replace(/_/g, " "), client.weightKg ? `${client.weightKg} kg` : null, client.heightCm ? `${client.heightCm} cm` : null].filter(Boolean).join(" · ") || "No setup details yet"}</Text>
            {Boolean(client.diet || client.allergies) && <Text className="home__note">{[client.diet, client.allergies ? `avoids ${client.allergies}` : null].filter(Boolean).join(" · ")}</Text>}
          </View>
          <Pressable onPress={message} className="home__icon-button" accessibilityRole="button" accessibilityLabel={`Message ${client.member.name}`}>
            <SymbolView name={{ ios: "bubble.left", android: "chat_bubble_outline", web: "chat_bubble_outline" }} size={18} tintColor={colors.forestInk} />
          </Pressable>
        </View>

        <View className="post__card gap-2">
          <Text className="setup__section">Recommended targets</Text>
          {client.targets && <Text className="home__note">{`Current: ${client.targets.kcal} kcal · P ${client.targets.proteinG} · C ${client.targets.carbsG} · F ${client.targets.fatG} (${client.targets.source.replace(/_/g, " ")})`}</Text>}
          {client.recommendation && <Text className="home__note">{`Last sent ${timeAgo(client.recommendation.createdAt)} · ${client.recommendation.appliedAt ? "applied by your client" : "not applied yet"}`}</Text>}
          <View className="flex-row gap-2">
            {field("calories", "kcal")}
            {field("proteinG", "Protein g")}
          </View>
          <View className="flex-row gap-2">
            {field("carbsG", "Carbs g")}
            {field("fatG", "Fat g")}
          </View>
          {valid && !macrosRoughlyMatch(numbers.calories, numbers) && <Text className="home__note" style={{ color: colors.warning }}>{`The macros add up to about ${macroKcal(numbers)} kcal. You can still send it.`}</Text>}
          <TextInput value={rec.note} onChangeText={(v) => setRec((r) => ({ ...r, note: v }))} placeholder="Note for your client (optional)" placeholderTextColor={colors.faint} maxLength={300} accessibilityLabel="Note for your client" style={input} />
          <Pressable onPress={saveRecommendation} disabled={saving} className="btn-forest" style={{ opacity: saving ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Send recommendation">
            {saving ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">Send recommendation</Text>}
          </Pressable>
        </View>

        <Pressable onPress={() => router.push({ pathname: "/trainer/client/[id]/plan", params: { id } })} className="post__card flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel={client.dietPlan ? "Edit diet plan" : "Write a diet plan"}>
          <View className="flex-1">
            <Text className="post__author">Diet plan</Text>
            <Text className="post__time">{client.dietPlan ? `${client.dietPlan.name} · ${planGoalLabels[client.dietPlan.goal]} · updated ${timeAgo(client.dietPlan.updatedAt)}` : "Not written yet"}</Text>
          </View>
          <Text className="admin__action-label">{client.dietPlan ? "Edit" : "Write"}</Text>
        </Pressable>

        <Pressable onPress={() => router.push({ pathname: "/trainer/client/[id]/workout", params: { id } })} className="post__card flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel="Write a workout">
          <View className="flex-1">
            <Text className="post__author">Workout</Text>
            <Text className="post__time">{client.workout ? `${client.workout.name} · ${client.workout.daysPerWeek} days a week` : "No active plan"}</Text>
          </View>
          <Text className="admin__action-label">{client.workout ? "Replace" : "Write"}</Text>
        </Pressable>

        <Pressable onPress={() => setConfirmEnd(true)} className="btn-outline mt-4" accessibilityRole="button" accessibilityLabel="End coaching">
          <Text className="btn-outline__label" style={{ color: colors.danger }}>End coaching</Text>
        </Pressable>
      </View>
    </AdminScreen>
      <ConfirmSheet
        visible={confirmEnd}
        title={`Stop coaching ${client.member.name.split(" ")[0]}?`}
        text="Your diet plan, workout and recommended targets are removed from their account. Their logged meals stay."
        confirmLabel="End coaching"
        busy={ending}
        onConfirm={endCoaching}
        onCancel={() => setConfirmEnd(false)}
      />
    </View>
  );
}
