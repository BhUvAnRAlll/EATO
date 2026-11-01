import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { AdminField } from "@/components/admin/AdminField";
import { SymbolView } from "@/components/SymbolView";
import { adminExercises, MUSCLE_LABEL, type DraftResult } from "@/lib/adminExercises";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/exercises"));

const COUNTS = [5, 10, 20];
const EXAMPLES = ["Home workouts with no equipment", "Yoga stretches for cool-down", "Dumbbell exercises for arms", "Low-impact cardio for beginners"];

// Super Admin › Exercises › Add with AI: the admin describes what to add and how many; the AI
// writes each exercise (name, details, steps), the server leaves out duplicates and anything
// incomplete, and the rest join the library at once, ready for their videos.
export default function AddExercisesScreen() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [request, setRequest] = useState("");
  const [count, setCount] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DraftResult | null>(null);

  const ask = async () => {
    const text = request.trim();
    if (text.length < 3) {
      setError("Describe the exercises to add, for example \"10 home yoga stretches\".");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    const answer = await adminExercises.draft(await getToken().catch(() => null), text, count);
    setBusy(false);
    if (answer.ok) setResult(answer.data);
    else setError(answer.error);
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title" accessibilityRole="header">Add with AI</Text>
          <View className="screen-bar__spacer" />
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 16 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}>
          <Text className="meta-text">The AI writes each exercise with its details and steps. Ones already in the library are left out. New exercises go live at once, so members can get them in their next plan.</Text>

          <AdminField label="What should the AI add?" value={request} onChangeText={setRequest} placeholder="For example: yoga stretches for cool-down" maxLength={200} multiline editable={!busy} accessibilityLabel="What the AI should add" />
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            {EXAMPLES.map((ex) => (
              <Pressable key={ex} onPress={() => setRequest(ex)} disabled={busy} className="admin-chip" accessibilityRole="button" accessibilityLabel={`Use: ${ex}`}>
                <Text className="admin-segment__label">{ex}</Text>
              </Pressable>
            ))}
          </View>

          <View style={{ gap: 6 }}>
            <Text className="auth__label">How many</Text>
            <View className="flex-row" style={{ gap: 8 }} accessibilityRole="radiogroup">
              {COUNTS.map((c) => (
                <Pressable key={c} onPress={() => setCount(c)} disabled={busy} className={count === c ? "admin-segment admin-segment--on" : "admin-segment"} accessibilityRole="radio" accessibilityState={{ checked: count === c }}>
                  <Text className={count === c ? "admin-segment__label admin-segment__label--on" : "admin-segment__label"}>{`Up to ${c}`}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {error && <Text className="admin__hint" style={{ color: colors.danger }}>{error}</Text>}

          <Pressable onPress={ask} disabled={busy} className="btn-forest flex-row items-center justify-center" style={{ gap: 8, opacity: busy ? 0.7 : 1 }} accessibilityRole="button" accessibilityState={{ disabled: busy }} accessibilityLabel={busy ? "The AI is writing exercises" : "Ask the AI"}>
            {busy ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <SymbolView name={{ ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }} size={16} tintColor={colors.onPrimary} />}
            <Text className="btn-forest__label">{busy ? "Writing exercises…" : "Ask the AI"}</Text>
          </Pressable>

          {result && (
            <>
              <Text className="setup__section">{result.added.length === 0 ? "Nothing new added" : `Added ${result.added.length} ${result.added.length === 1 ? "exercise" : "exercises"}`}</Text>
              {result.added.length > 0 && (
                <View className="admin-list">
                  {result.added.map((e, i) => (
                    <Pressable key={e.id} onPress={() => router.push({ pathname: "/admin/exercises/[id]", params: { id: e.id } })} className={i > 0 ? "admin-row admin-row--divided" : "admin-row"} accessibilityRole="button" accessibilityLabel={`${e.name}, ${MUSCLE_LABEL[e.muscleGroup]}. Open`}>
                      <View className="admin-row__icon"><SymbolView name={{ ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" }} size={18} tintColor={colors.success} /></View>
                      <View className="min-w-0 flex-1" style={{ gap: 2 }}>
                        <Text className="card__title" numberOfLines={1}>{e.name}</Text>
                        <Text className="meta-text" numberOfLines={1}>{`${MUSCLE_LABEL[e.muscleGroup]} · ${e.equipment} · needs a video`}</Text>
                      </View>
                      <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
                    </Pressable>
                  ))}
                </View>
              )}
              {result.skipped.length > 0 && (
                <>
                  <Text className="setup__section">{`Left out (${result.skipped.length})`}</Text>
                  <View className="admin-list">
                    {result.skipped.map((s, i) => (
                      <View key={`${s.name}-${i}`} className={i > 0 ? "admin-row admin-row--divided" : "admin-row"}>
                        <View className="min-w-0 flex-1" style={{ gap: 2 }}>
                          <Text className="card__title" numberOfLines={1}>{s.name}</Text>
                          <Text className="meta-text">{s.reason}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </>
              )}
              <Pressable onPress={back} className="admin__action self-center" accessibilityRole="button">
                <Text className="admin__action-label">Back to exercises</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
