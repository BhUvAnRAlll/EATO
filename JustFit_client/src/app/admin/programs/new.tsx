import { useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { ProgramForm } from "@/components/admin/ProgramForm";
import { adminPrograms, type ProgramFields } from "@/lib/adminPrograms";
import { useSessionToken } from "@/lib/session";
import { useAdminSections } from "@/lib/useAdminSections";
import { useThemeColors } from "@/theme";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";
import { AdminStackHeader } from "@/components/admin/AdminStackHeader";

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/programs"));

const BLANK: ProgramFields = { title: "", subtitle: "", description: "", section: "stay_fit", place: "both", level: "beginner", kit: "none", icon: "strength", palette: "lavender", published: true };

// Super Admin › Programs › New program: the admin writes what it is; its sessions (YouTube
// videos) are added on its page next. It goes on the members' Fitness tab at once, as "Coming
// soon" until it has sessions (it can be hidden after).
export default function NewProgramScreen() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [form, setForm] = useState<ProgramFields>(BLANK);
  const sections = useAdminSections();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref, not the state: two taps in one frame both see busy === false (two programs created)
  const running = useRef(false);

  const create = async () => {
    if (running.current) return;
    if (form.title.trim().length < 3) return setError("Give the program a title of at least 3 characters.");
    running.current = true;
    setBusy(true);
    setError(null);
    let result: Awaited<ReturnType<typeof adminPrograms.create>>;
    try {
      result = await adminPrograms.create(await getToken().catch(() => null), form);
    } finally {
      running.current = false;
      setBusy(false);
    }
    if (!result.ok) return setError(result.error);
    router.replace({ pathname: "/admin/programs/[id]", params: { id: result.data.id } });
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <AdminStackHeader title="New program" onBack={back} />
        {/* Keeps the lower fields and Save above the keyboard on Android too */}
        <KeyboardAvoider>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 48, gap: 16 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}>
            <ProgramForm value={form} onChange={setForm} disabled={busy} sections={sections} />
            {error && <Text className="meta-text" style={{ color: colors.danger }}>{error}</Text>}
            <Pressable onPress={create} disabled={busy} className="btn-forest flex-row items-center justify-center" style={{ gap: 8, opacity: busy ? 0.7 : 1 }} accessibilityRole="button" accessibilityState={{ disabled: busy }}>
              {busy ? <ActivityIndicator size="small" color={colors.onPrimary} /> : null}
              <Text className="btn-forest__label">Create program</Text>
            </Pressable>
            <Text className="admin__hint">The program is free for every member. Once it exists, add its sessions (one YouTube video each) from its page.</Text>
          </ScrollView>
        </KeyboardAvoider>
      </SafeAreaView>
    </View>
  );
}
