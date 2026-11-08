import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { ProgramForm } from "@/components/admin/ProgramForm";
import { ProgramSessions, type SessionOutcome } from "@/components/admin/ProgramSessions";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { adminPrograms, pickCover, type ProgramFields } from "@/lib/adminPrograms";
import type { ProgramIcon, ProgramPalette } from "@/lib/fitness/catalog";
import { programMeta, type ProgramDetail } from "@/lib/fitnessApi";
import { useSessionToken } from "@/lib/session";
import { useAdminSections } from "@/lib/useAdminSections";
import { useSwitchColors, useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; program: ProgramDetail };
type Kind = "save" | "publish" | "cover" | "hero" | "session";

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/programs"));

const fieldsOf = (p: ProgramDetail): ProgramFields => ({
  title: p.title, subtitle: p.subtitle, description: p.description, section: p.section, place: p.place, level: p.level, kit: p.kit,
  icon: p.icon as ProgramIcon, palette: p.palette as ProgramPalette, published: p.published !== false,
});
const sameFields = (a: ProgramFields, b: ProgramFields) => (Object.keys(a) as (keyof ProgramFields)[]).every((k) => a[k] === b[k]);

// Asks before something is taken away. React Native's Alert does nothing on the web, so the
// browser asks there.
const confirmThen = (question: string, detail: string, action: string, go: () => void) => {
  if (Platform.OS === "web") {
    if (globalThis.confirm?.(`${question} ${detail}`)) go();
    return;
  }
  Alert.alert(question, detail, [
    { text: "Cancel", style: "cancel" },
    { text: action, style: "destructive", onPress: go },
  ]);
};

// Super Admin › Programs › one program: shown to members or hidden, its cover photo for the card
// and its page photo for the top of the program's screen (each added, replaced or removed under the
// preview card, saved at once), its fields (Save), and its sessions: each a YouTube video the
// admin adds, edits, reorders or deletes (ProgramSessions).
export default function AdminProgramScreen() {
  const colors = useThemeColors();
  const switchColors = useSwitchColors();
  const getToken = useSessionToken();
  const { id } = useLocalSearchParams<{ id: string }>();
  const sections = useAdminSections();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [form, setForm] = useState<ProgramFields | null>(null);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  // A ref, not the state: two taps in one frame both see busy === null
  const running = useRef(false);
  // The fields the form was last set from, and the form as it is: a read (coming back from New
  // category, a pull) only replaces the form when nothing has been edited in it
  const saved = useRef<ProgramFields | null>(null);
  const formNow = useRef<ProgramFields | null>(null);
  const changeForm = (next: ProgramFields | null) => {
    formNow.current = next;
    setForm(next);
  };

  const show = (program: ProgramDetail) => {
    saved.current = fieldsOf(program);
    setLoad({ state: "ready", program });
    changeForm(saved.current);
  };

  const refresh = useCallback(async () => {
    const result = await adminPrograms.detail(await getToken().catch(() => null), String(id));
    if (!result.ok) {
      // A failed read after the first keeps the program on screen and says so
      setLoad((current) => (current.state === "ready" ? current : { state: "failed", error: result.error }));
      setMessage((current) => (formNow.current ? { text: result.error, error: true } : current));
      return;
    }
    setLoad({ state: "ready", program: result.data });
    const edited = formNow.current && saved.current && !sameFields(formNow.current, saved.current);
    if (!edited) {
      saved.current = fieldsOf(result.data);
      changeForm(saved.current);
    }
  }, [getToken, id]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );
  const { refreshControl } = usePullToRefresh(refresh);

  // One admin call at a time; the outcome goes back to whoever asked (the session form shows its
  // own error) and the message line says what happened
  const run = async (kind: Kind, call: (token: string | null) => Promise<{ ok: true; data: ProgramDetail } | { ok: false; error: string }>, done: string): Promise<SessionOutcome> => {
    if (running.current) return { ok: false, error: "" };
    running.current = true;
    setBusy(kind);
    setMessage(null);
    let result: { ok: true; data: ProgramDetail } | { ok: false; error: string };
    try {
      result = await call(await getToken().catch(() => null));
    } finally {
      running.current = false;
      setBusy(null);
    }
    if (!result.ok) {
      setMessage({ text: result.error, error: true });
      return result;
    }
    // Save replaces the form with what was saved; a photo, session or visibility change keeps any unsaved edits
    if (kind === "save") show(result.data);
    else setLoad({ state: "ready", program: result.data });
    // Saved, but YouTube couldn't be asked who made the video: say why (it's asked again later)
    setMessage(result.data.videoError ? { text: `${done} YouTube didn't answer for the video: ${result.data.videoError}`, error: true } : { text: done, error: false });
    return { ok: true };
  };

  // The photo library (which can refuse to open), then the upload (the old photo stays until the new one is saved)
  const pickPhoto = async () => {
    setMessage(null);
    const picked = await pickCover().catch(() => ({ ok: false as const, error: "The photo library couldn't be opened. Please try again." }));
    if (!picked.ok) {
      if ("error" in picked) setMessage({ text: picked.error, error: true });
      return null;
    }
    return picked.photo;
  };
  const changeCover = async (programId: string, replacing: boolean) => {
    const photo = await pickPhoto();
    if (photo) run("cover", (t) => adminPrograms.setCover(t, programId, photo), replacing ? "Cover replaced." : "Cover added.");
  };
  const changeHero = async (programId: string, replacing: boolean) => {
    const photo = await pickPhoto();
    if (photo) run("hero", (t) => adminPrograms.setHero(t, programId, photo), replacing ? "Page photo replaced." : "Page photo added.");
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

        {load.state === "failed" ? (
          <View className="px-4">
            <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the program" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={() => { setLoad({ state: "loading" }); refresh(); }} />
          </View>
        ) : load.state === "loading" || !form ? (
          <View className="px-4"><ScreenSkeleton label="Loading the program" /></View>
        ) : (
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 48, gap: 16 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            automaticallyAdjustKeyboardInsets
            refreshControl={refreshControl}
          >
            <View className="admin-list">
              <View className="admin-row">
                <View className="min-w-0 flex-1">
                  <Text className="card__title">Shown to members</Text>
                  <Text className="meta-text">{load.program.published !== false ? "On the Fitness tab now" : "Hidden from the Fitness tab"}</Text>
                </View>
                {busy === "publish" ? <ActivityIndicator color={colors.leaf} /> : (
                  <Switch
                    value={load.program.published !== false}
                    disabled={busy !== null}
                    onValueChange={(v) => {
                      const go = () => run("publish", (t) => adminPrograms.update(t, load.program.id, { published: v }), v ? "Shown to members." : "Hidden from members.");
                      // Showing is one flip; hiding takes it off every member's Fitness tab, so it asks first
                      if (v) go();
                      else confirmThen("Hide this program?", "Members won't see it on the Fitness tab until it's shown again.", "Hide", go);
                    }}
                    {...switchColors}
                    accessibilityLabel="Shown to members"
                  />
                )}
              </View>
            </View>

            {message && <Text className="meta-text" style={{ color: message.error ? colors.danger : colors.success }}>{message.text}</Text>}

            <ProgramForm
              value={form}
              onChange={changeForm}
              disabled={busy !== null}
              sections={sections}
              cover={{
                url: load.program.coverUrl ?? null,
                busy: busy === "cover",
                onPick: () => changeCover(load.program.id, Boolean(load.program.coverUrl)),
                onRemove: () => confirmThen("Remove the cover?", "The card shows the program's colours instead.", "Remove", () => run("cover", (t) => adminPrograms.removeCover(t, load.program.id), "Cover removed.")),
              }}
              hero={{
                url: load.program.heroUrl ?? null,
                busy: busy === "hero",
                onPick: () => changeHero(load.program.id, Boolean(load.program.heroUrl)),
                onRemove: () => confirmThen("Remove the page photo?", "The top of the program's page shows the colours instead.", "Remove", () => run("hero", (t) => adminPrograms.removeHero(t, load.program.id), "Page photo removed.")),
              }}
            />
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
            <ProgramSessions
              sessions={load.program.sessions}
              busy={busy === "session"}
              disabled={busy !== null}
              onAdd={(session) => run("session", (t) => adminPrograms.addSession(t, load.program.id, session), "Session added.")}
              onEdit={(sessionId, session) => run("session", (t) => adminPrograms.editSession(t, load.program.id, sessionId, session), "Session saved.")}
              onDelete={(sessionId) => run("session", (t) => adminPrograms.deleteSession(t, load.program.id, sessionId), "Session deleted.")}
              onMove={(sessionId, direction) => run("session", (t) => adminPrograms.moveSession(t, load.program.id, sessionId, direction), "Session moved.")}
            />
            <Text className="admin__hint">{"Each session is one YouTube video, played in YouTube's own player on the program's page. Paste a video's link; playlists and uploaded files aren't used."}</Text>
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}
