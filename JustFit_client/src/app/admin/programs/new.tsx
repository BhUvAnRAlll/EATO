import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { ChoiceChips } from "@/components/admin/AdminField";
import { ProgramForm } from "@/components/admin/ProgramForm";
import { SymbolView } from "@/components/SymbolView";
import { adminPrograms, type ProgramFields } from "@/lib/adminPrograms";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/programs"));

const BLANK: ProgramFields = { title: "", subtitle: "", description: "", section: "stay_fit", place: "both", level: "beginner", kit: "none", icon: "strength", palette: "lavender", published: true };

// Super Admin › Programs › New program: the admin writes what it is; the AI writes its sessions
// from the exercise library. It goes on the members' Fitness tab at once (it can be hidden after).
export default function NewProgramScreen() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [form, setForm] = useState<ProgramFields>(BLANK);
  const [sessions, setSessions] = useState("3");
  const [minutes, setMinutes] = useState("30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (form.title.trim().length < 3) return setError("Give the program a title of at least 3 characters.");
    setBusy(true);
    setError(null);
    const result = await adminPrograms.create(await getToken().catch(() => null), { ...form, sessions: Number(sessions), minutes: Number(minutes) });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    router.replace({ pathname: "/admin/programs/[id]", params: { id: result.data.id } });
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title" accessibilityRole="header">New program</Text>
          <View className="screen-bar__spacer" />
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 48, gap: 16 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}>
          <ProgramForm value={form} onChange={setForm} disabled={busy} />
          <ChoiceChips label="Sessions" options={["1", "2", "3", "4", "5", "6"].map((n) => ({ value: n, label: n }))} value={sessions} onChange={setSessions} />
          <ChoiceChips label="Minutes per session" options={["10", "15", "20", "30", "45", "60"].map((n) => ({ value: n, label: `${n} min` }))} value={minutes} onChange={setMinutes} />
          {error && <Text className="meta-text" style={{ color: colors.danger }}>{error}</Text>}
          <Pressable onPress={create} disabled={busy} className="btn-forest flex-row items-center justify-center" style={{ gap: 8, opacity: busy ? 0.7 : 1 }} accessibilityRole="button" accessibilityState={{ disabled: busy }}>
            {busy ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <SymbolView name={{ ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }} size={16} tintColor={colors.onPrimary} />}
            <Text className="btn-forest__label">{busy ? "Writing sessions…" : "Create with AI"}</Text>
          </Pressable>
          <Text className="admin__hint">The AI picks exercises from Admin › Exercises that fit the level and equipment. The program is free for every member.</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
