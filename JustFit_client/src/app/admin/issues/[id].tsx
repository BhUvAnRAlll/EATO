import { useCallback, useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";

import { AdminScreen } from "@/components/admin/AdminScreen";
import { FormAlert } from "@/components/FormAlert";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { ISSUE_CATEGORY_LABEL, ISSUE_STATUS_LABEL } from "@/data/issues";
import { hud } from "@/lib/hud";
import { issuesApi, type IssueAction } from "@/lib/issuesApi";
import { mealImage } from "@/lib/mealsApi";
import { useGymData } from "@/lib/useGymData";
import { useSessionToken } from "@/lib/session";
import { useAuthStore } from "@/store/auth";
import { useThemeColors } from "@/theme";

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const ACTION_WORD: Record<string, string> = { opened: "Reported", assign: "Taken", progress: "In progress", note: "Note", resolve: "Resolved", reject: "Closed", reopen: "Reopened" };

// Super Admin › Issues › one (Meal Operations phase 6): what the member reported (and their photo),
// the member (Call, their meal side), the order; Take it, In progress, a note, Resolve with a note
// and an optional refund (at most what was paid; a recorded decision in test mode), Close with a
// reason, Reopen; and the audit trail.
export default function AdminIssue() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const token = useAuthStore((state) => state.token);
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback((t: string | null) => issuesApi.one(t, Number(id)), [id]);
  const { result, retry, refresh, update } = useGymData(load);
  const [note, setNote] = useState("");
  const [refund, setRefund] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const issue = result.state === "ready" ? result.data.issue : null;
  const closed = issue?.status === "resolved" || issue?.status === "rejected";

  const act = async (action: IssueAction) => {
    if (!issue || busy) return;
    setBusy(true);
    setError("");
    const body = { ...(note.trim() ? { note: note.trim() } : {}), ...(action === "resolve" && refund ? { refund: Number(refund) } : {}) };
    const answer = await issuesApi.act(await getToken(), issue.id, action, body);
    setBusy(false);
    if (!answer.ok) return setError(answer.error);
    update(() => answer.data);
    setNote("");
    setRefund("");
    hud.success(ACTION_WORD[action] ?? "Saved");
  };

  return (
    <AdminScreen title={issue?.code ?? "Issue"} subtitle={issue ? ISSUE_CATEGORY_LABEL[issue.category] : undefined} onRefresh={refresh}>
      {result.state === "loading" && <ScreenSkeleton label="Loading the issue" />}
      {result.state === "failed" && (
        <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the issue" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
      )}
      {issue && (
        <View style={{ gap: 14 }}>
          <View className="card" style={{ gap: 6 }}>
            <Text className="type-overline text-muted">{`${ISSUE_STATUS_LABEL[issue.status]}${issue.assignedTo ? ` · ${issue.assignedTo}` : ""}`}</Text>
            <Text className="type-body text-forest-ink">{issue.description}</Text>
            {issue.photoUrl ? <Image source={mealImage(issue.photoUrl, token)} contentFit="cover" style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 12 }} accessibilityLabel="The member's photo" /> : null}
            <Text className="meta-text">{`${issue.member?.name ?? "Member"}${issue.orderCode ? ` · order #${issue.orderCode}${issue.orderTotal != null ? ` · ₹${issue.orderTotal}` : ""}` : " · meal plan"}`}</Text>
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {issue.member?.phone ? (
                <Pressable onPress={() => Linking.openURL(`tel:${issue.member?.phone}`).catch(() => hud.error("Couldn't open the phone app"))} className="admin-chip" accessibilityRole="button">
                  <Text className="admin-segment__label admin-segment__label--on">Call</Text>
                </Pressable>
              ) : null}
              {issue.member ? (
                <Pressable onPress={() => router.push({ pathname: "/admin/customers/[userId]", params: { userId: issue.member!.id } })} className="admin-chip" accessibilityRole="button">
                  <Text className="admin-segment__label admin-segment__label--on">Their orders and plans</Text>
                </Pressable>
              ) : null}
            </View>
            {issue.resolutionNote ? <Text className="type-body text-forest-ink">{`Resolution: ${issue.resolutionNote}${issue.refund ? ` · refund ₹${issue.refund}` : ""}`}</Text> : null}
          </View>

          <View className="card" style={{ gap: 10 }}>
            <TextInput className="admin__input" value={note} onChangeText={setNote} multiline maxLength={300} placeholder={closed ? "Why it's reopened (optional)" : "A note, or the resolution / reason to close"} placeholderTextColor={colors.faint} style={{ minHeight: 64, textAlignVertical: "top" }} accessibilityLabel="Note" />
            {!closed && issue.orderId ? (
              <TextInput className="admin__input" value={refund} onChangeText={(t) => setRefund(t.replace(/[^0-9]/g, "").slice(0, 6))} keyboardType="number-pad" placeholder={`Refund ₹ (optional, up to ${issue.orderTotal ?? 0})`} placeholderTextColor={colors.faint} accessibilityLabel="Refund in rupees" />
            ) : null}
            {error ? <FormAlert message={error} /> : null}
            {busy ? <ActivityIndicator color={colors.leaf} /> : null}
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {closed ? (
                <Pressable onPress={() => act("reopen")} className="admin-chip" accessibilityRole="button"><Text className="admin-segment__label admin-segment__label--on">Reopen</Text></Pressable>
              ) : (
                <>
                  {issue.status === "open" ? <Pressable onPress={() => act("assign")} className="admin-chip admin-chip--on" accessibilityRole="button"><Text className="admin-segment__label admin-segment__label--on">Take it</Text></Pressable> : null}
                  <Pressable onPress={() => act("note")} className="admin-chip" accessibilityRole="button"><Text className="admin-segment__label admin-segment__label--on">Add note</Text></Pressable>
                  <Pressable onPress={() => act("resolve")} className="admin-chip" accessibilityRole="button"><Text className="admin-segment__label admin-segment__label--on">Resolve</Text></Pressable>
                  <Pressable onPress={() => act("reject")} className="admin-chip" accessibilityRole="button"><Text className="admin-segment__label" style={{ color: colors.danger }}>Close</Text></Pressable>
                </>
              )}
            </View>
            {!closed ? <Text className="meta-text">Resolve and Close need a note; the member reads it. Payments are in test mode, so a refund is recorded, not paid.</Text> : null}
          </View>

          <Text className="admin-section__title">Trail</Text>
          {(issue.events ?? []).map((e, i) => (
            <View key={`${e.action}-${i}`} style={{ gap: 2 }}>
              <Text className="type-body text-forest-ink">{`${ACTION_WORD[e.action] ?? e.action}${e.by ? ` · ${e.by}` : ""}`}</Text>
              <Text className="meta-text">{[when(e.at), e.note].filter(Boolean).join(" · ")}</Text>
            </View>
          ))}
        </View>
      )}
    </AdminScreen>
  );
}
