import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { AdminStackHeader } from "@/components/admin/AdminStackHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { AdminField } from "@/components/admin/AdminField";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { complaintsApi, type AdminComplaint, type ComplaintStatus } from "@/lib/complaints";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

const MOVES: { id: ComplaintStatus; label: string; closes: boolean }[] = [
  { id: "investigating", label: "Investigating", closes: false },
  { id: "resolved", label: "Resolve", closes: true },
  { id: "dismissed", label: "Dismiss", closes: true },
  { id: "open", label: "Open again", closes: false },
];
const HISTORY_WORDS = { created: "Reported", assigned: "Taken", note: "Note", status: "Status" } as const;

// Super Admin › a complaint: what was reported, about which gym and by whom; take it, add internal
// notes (never shown to the member), and move it, closing it with words the member reads.
export default function AdminComplaint() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const caseId = Number(id);
  const load = useCallback((token: string | null) => complaintsApi.detail(token, caseId), [caseId]);
  const { result, retry, set, refreshing, refresh } = useGymData(load);
  const [note, setNote] = useState("");
  const [move, setMove] = useState<ComplaintStatus | null>(null);
  const [resolution, setResolution] = useState("");
  const save = useGymSave((data: AdminComplaint) => {
    set(data);
    setNote("");
    setMove(null);
    setResolution("");
  }, "Saved");

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <AdminStackHeader title={`Complaint #${id}`} fallback="/admin/complaints" />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.leaf} colors={[colors.leaf]} />} showsVerticalScrollIndicator={false}>
          {result.state === "loading" ? <ScreenSkeleton cards={3} label="Loading the complaint" /> : null}
          {result.state === "failed" ? <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load it" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} /> : null}
          {result.state === "ready" ? (() => {
            const c = result.data.complaint;
            const closing = MOVES.find((m) => m.id === move)?.closes ?? false;
            const ready = move !== null && (!closing || resolution.trim().length >= 5);
            return (
              <>
                <View className="card" style={{ gap: 6 }}>
                  <Text className="type-caption text-muted">{`${c.statusLabel.toUpperCase()} · ${c.categoryLabel}`}</Text>
                  <Pressable onPress={() => router.push({ pathname: "/admin/gyms/[id]", params: { id: String(c.gym.id) } })} accessibilityRole="button">
                    <Text className="card__title text-primary-text">{`${c.gym.name} ${c.gym.branch}, ${c.city}`}</Text>
                  </Pressable>
                  <Text className="type-body">{c.details}</Text>
                  <Text className="meta-text">{`By ${c.reporter.name}${c.reporter.phone ? ` · ${c.reporter.phone}` : ""} · ${c.createdAt ? new Date(c.createdAt).toLocaleString("en-IN") : ""}`}</Text>
                  {c.otherReportsAboutGym > 0 ? <Text className="meta-text">{`${c.otherReportsAboutGym} other ${c.otherReportsAboutGym === 1 ? "report" : "reports"} about this gym`}</Text> : null}
                  <Text className="meta-text">{c.assignee ? `${c.assignee.name} is on it` : "Nobody has taken it yet"}</Text>
                  {c.resolution ? <Text className="type-body">{`Told the member: “${c.resolution}”`}</Text> : null}
                </View>
                {save.error ? <FormAlert message={save.error} /> : null}
                <Pressable onPress={() => save.save((t) => complaintsApi.assign(t, caseId))} className="admin-chip self-start" accessibilityRole="button">
                  <Text className="type-caption text-ink">Take this case</Text>
                </Pressable>

                <View className="card" style={{ gap: 8 }}>
                  <Text className="admin-section__title">Internal note</Text>
                  <AdminField label="Only justFit admins see it" value={note} onChangeText={setNote} maxLength={1000} multiline />
                  <Pressable onPress={() => note.trim().length >= 3 && save.save((t) => complaintsApi.note(t, caseId, note.trim()))} disabled={note.trim().length < 3 || save.busy} className={note.trim().length < 3 ? "btn-forest btn--disabled" : "btn-forest"} accessibilityRole="button">
                    <Text className={note.trim().length < 3 ? "btn-forest__label btn--disabled-label" : "btn-forest__label"}>Add note</Text>
                  </Pressable>
                </View>

                <View className="card" style={{ gap: 8 }}>
                  <Text className="admin-section__title">Move it</Text>
                  <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                    {MOVES.filter((m) => m.id !== c.status && (m.id !== "open" || ["resolved", "dismissed"].includes(c.status))).map((m) => (
                      <Pressable key={m.id} onPress={() => setMove(move === m.id ? null : m.id)} className={move === m.id ? "admin-chip admin-chip--on" : "admin-chip"} accessibilityRole="button" accessibilityState={{ selected: move === m.id }}>
                        <Text className="type-caption text-ink">{m.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {closing ? <AdminField label="What the member is told" value={resolution} onChangeText={setResolution} maxLength={500} multiline /> : null}
                  {move ? (
                    <Pressable onPress={() => ready && move && save.save((t) => complaintsApi.status(t, caseId, move, resolution))} disabled={!ready || save.busy} className={ready ? "btn-forest" : "btn-forest btn--disabled"} accessibilityRole="button">
                      <Text className={ready ? "btn-forest__label" : "btn-forest__label btn--disabled-label"}>{save.busy ? "Saving…" : "Save"}</Text>
                    </Pressable>
                  ) : null}
                </View>

                <View className="card" style={{ gap: 8 }}>
                  <Text className="admin-section__title">History</Text>
                  {result.data.history.map((h, i) => (
                    <View key={i} style={{ gap: 2 }}>
                      <Text className="type-body">{`${HISTORY_WORDS[h.kind]}${h.status ? ` · ${h.status}` : ""} · ${h.by}`}</Text>
                      {h.note ? <Text className="meta-text">{h.note}</Text> : null}
                      {h.at ? <Text className="meta-text">{new Date(h.at).toLocaleString("en-IN")}</Text> : null}
                    </View>
                  ))}
                </View>
              </>
            );
          })() : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
