import { useCallback, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { AdminField } from "@/components/admin/AdminField";
import { ProgramForm } from "@/components/admin/ProgramForm";
import { SymbolView } from "@/components/SymbolView";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { adminPrograms, type ProgramFields } from "@/lib/adminPrograms";
import type { ProgramIcon, ProgramPalette } from "@/lib/fitness/catalog";
import { programMeta, type ProgramDetail } from "@/lib/fitnessApi";
import { useSessionToken } from "@/lib/session";
import { useSwitchColors, useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; program: ProgramDetail };

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/programs"));

const fieldsOf = (p: ProgramDetail): ProgramFields => ({
  title: p.title, subtitle: p.subtitle, description: p.description, section: p.section, place: p.place, level: p.level, kit: p.kit,
  icon: p.icon as ProgramIcon, palette: p.palette as ProgramPalette, published: p.published !== false,
});

// Super Admin › Programs › one program: shown to members or hidden, its fields (Save), and its
// sessions, which the AI can rewrite from the exercise library (an optional note steers it).
export default function AdminProgramScreen() {
  const colors = useThemeColors();
  const switchColors = useSwitchColors();
  const getToken = useSessionToken();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [form, setForm] = useState<ProgramFields | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"save" | "publish" | "redraft" | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const show = (program: ProgramDetail) => {
    setLoad({ state: "ready", program });
    setForm(fieldsOf(program));
  };

  const refresh = useCallback(async () => {
    const result = await adminPrograms.detail(await getToken().catch(() => null), String(id));
    if (result.ok) show(result.data);
    else setLoad({ state: "failed", error: result.error });
  }, [getToken, id]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const run = async (kind: "save" | "publish" | "redraft", call: (token: string | null) => Promise<{ ok: true; data: ProgramDetail } | { ok: false; error: string }>, done: string) => {
    setBusy(kind);
    setMessage(null);
    const result = await call(await getToken().catch(() => null));
    setBusy(null);
    if (!result.ok) return setMessage({ text: result.error, error: true });
    show(result.data);
    setMessage({ text: done, error: false });
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title" accessibilityRole="header">Program</Text>
          <View className="screen-bar__spacer" />
        </View>

        {load.state === "loading" || !form ? (
          load.state === "failed" ? (
            <View className="px-4">
              <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the program" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={() => { setLoad({ state: "loading" }); refresh(); }} />
            </View>
          ) : (
            <View className="items-center py-16"><ActivityIndicator color={colors.leaf} /></View>
          )
        ) : load.state === "ready" ? (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 48, gap: 16 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}>
            <View className="admin-list">
              <View className="admin-row">
                <View className="min-w-0 flex-1">
                  <Text className="card__title">Shown to members</Text>
                  <Text className="meta-text">{load.program.published !== false ? "On the Fitness tab now" : "Hidden from the Fitness tab"}</Text>
                </View>
                {busy === "publish" ? <ActivityIndicator color={colors.leaf} /> : (
                  <Switch value={load.program.published !== false} disabled={busy !== null} onValueChange={(v) => run("publish", (t) => adminPrograms.update(t, load.program.id, { published: v }), v ? "Shown to members." : "Hidden from members.")} {...switchColors} accessibilityLabel="Shown to members" />
                )}
              </View>
            </View>

            {message && <Text className="meta-text" style={{ color: message.error ? colors.danger : colors.success }}>{message.text}</Text>}

            <ProgramForm value={form} onChange={setForm} disabled={busy !== null} />
            <Pressable
              onPress={() => {
                const { published: _published, ...fields } = form;
                run("save", (t) => adminPrograms.update(t, load.program.id, fields), "Saved.");
              }}
              disabled={busy !== null}
              className="btn-forest"
              style={{ opacity: busy ? 0.7 : 1 }}
              accessibilityRole="button"
            >
              {busy === "save" ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Text className="btn-forest__label">Save</Text>}
            </Pressable>

            <Text className="setup__section">{`Sessions · ${programMeta(load.program)}`}</Text>
            {load.program.sessions.map((s, i) => (
              <View key={s.id} className="fitness-session" style={{ gap: 6 }}>
                <Text className="type-subhead text-forest-ink">{`${i + 1}. ${s.title} · ${s.minutes} min`}</Text>
                <Text className="meta-text">{s.exercises.map((e) => e.name).join(", ")}</Text>
              </View>
            ))}
            <AdminField label="Note for the AI (optional)" value={note} onChangeText={setNote} maxLength={300} placeholder="For example: more core work, shorter sessions" editable={busy === null} />
            <Pressable onPress={() => run("redraft", (t) => adminPrograms.redraft(t, load.program.id, note.trim()), "The AI rewrote the sessions.")} disabled={busy !== null} className="btn-outline flex-row items-center justify-center" style={{ gap: 8, opacity: busy ? 0.7 : 1 }} accessibilityRole="button" accessibilityLabel="Rewrite the sessions with AI">
              {busy === "redraft" ? <ActivityIndicator size="small" color={colors.leaf} /> : <SymbolView name={{ ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }} size={16} tintColor={colors.forestInk} />}
              <Text className="btn-outline__label">{busy === "redraft" ? "Writing sessions…" : "Rewrite sessions with AI"}</Text>
            </Pressable>
            <Text className="admin__hint">The AI uses exercises from Admin › Exercises. For yoga or dance programs, add those exercises there first. Members who already did a session keep their copy.</Text>
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </View>
  );
}
