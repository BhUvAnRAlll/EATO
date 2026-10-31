import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { AdminButton, AdminScreen } from "@/components/admin/AdminScreen";
import { AuthImage } from "@/components/community/AuthImage";
import { adminModeration, timeAgo, type ReportDetail, type SuspendedMember } from "@/lib/community";
import { useSessionToken } from "@/lib/session";
import { useCommunityStore } from "@/store/community";
import { colors } from "@/theme";

// Community moderation for admins: open reports (with the reported content and actions)
// and the list of suspended members. Every action is checked again on the server.
export default function AdminModeration() {
  const getToken = useSessionToken();
  const setToken = useCommunityStore((state) => state.setToken);
  const [reports, setReports] = useState<ReportDetail[] | null>(null);
  const [suspended, setSuspended] = useState<SuspendedMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const token = await getToken();
    setToken(token); // the reported images load with the session token
    const [list, members] = await Promise.all([adminModeration.openReports(token), adminModeration.suspendedMembers(token)]);
    if (!list.ok) return setError(list.error);
    // Each report with its content
    const details = await Promise.all(list.data.reports.map((report) => adminModeration.report(token, report.id)));
    setReports(details.flatMap((d) => (d.ok ? [d.data.report] : [])));
    setSuspended(members.ok ? members.data.members : []);
    setError(null);
  }, [getToken, setToken]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Runs one admin call, then reloads
  const run = async (call: (token: string | null) => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    const result = await call(await getToken());
    if (!result.ok) setError(result.error ?? "Something went wrong. Please try again.");
    await load();
    setBusy(false);
  };

  return (
    <AdminScreen title="Community moderation" subtitle="Reports from members, and who is suspended. Deleting content and suspending members takes effect at once." onRefresh={load}>
      {error && (
        <Pressable onPress={() => setError(null)} className="mb-3">
          <FormAlert message={error} />
        </Pressable>
      )}

      <Text className="setup__section mb-2">Open reports</Text>
      {reports === null ? (
        <ActivityIndicator color={colors.forest} className="my-6" />
      ) : reports.length === 0 ? (
        <Text className="admin__hint mb-4">No open reports.</Text>
      ) : (
        <View className="mb-4 gap-3">
          {reports.map((report) => (
            <View key={report.id} className="admin__row gap-2">
              <Text className="card__subtitle">
                {report.reporter.name} reported a {report.target.type} · {timeAgo(report.createdAt)}
              </Text>
              <Text className="card__title">Reason: {report.reason}</Text>
              <View className="setup__info">
                <View className="flex-1">
                  <Text className="setup__card-text">
                    {report.target.author.name}
                    {report.target.authorSuspended ? " (suspended)" : ""}
                    {report.target.deleted ? " · content deleted" : report.target.expired ? " · story ended" : ""}
                  </Text>
                  <Text className="post__body mt-1" numberOfLines={6}>
                    {report.target.body}
                  </Text>
                  {report.target.imageUrl && <AuthImage path={report.target.imageUrl} style={{ width: 160, height: 100, borderRadius: 10, marginTop: 8 }} />}
                </View>
              </View>
              <View className="flex-row flex-wrap gap-2">
                {!report.target.deleted && (
                  <AdminButton
                    label={report.target.type === "post" ? "Delete post" : report.target.type === "story" ? "Delete story" : "Delete comment"}
                    variant="danger"
                    disabled={busy}
                    onPress={() =>
                      run((token) =>
                        report.target.type === "post"
                          ? adminModeration.deletePost(token, report.target.id)
                          : report.target.type === "story"
                            ? adminModeration.deleteStory(token, report.target.id)
                            : adminModeration.deleteComment(token, report.target.id),
                      )
                    }
                  />
                )}
                {!report.target.authorSuspended && (
                  <AdminButton label="Suspend author" variant="danger" disabled={busy} onPress={() => run((token) => adminModeration.setSuspended(token, report.target.author.id, true))} />
                )}
                <AdminButton label="Mark reviewed" variant="primary" disabled={busy} onPress={() => run((token) => adminModeration.resolve(token, report.id, "reviewed"))} />
                <AdminButton label="Dismiss" disabled={busy} onPress={() => run((token) => adminModeration.resolve(token, report.id, "dismissed"))} />
              </View>
            </View>
          ))}
        </View>
      )}

      <Text className="setup__section mb-2">Suspended members</Text>
      {suspended.length === 0 ? (
        <Text className="admin__hint">Nobody is suspended.</Text>
      ) : (
        <View className="gap-3">
          {suspended.map((entry) => (
            <View key={entry.member.id} className="admin__row flex-row items-center gap-3">
              <View className="flex-1">
                <Text className="card__title">{entry.member.name}</Text>
                <Text className="card__subtitle">Suspended {timeAgo(entry.since)}</Text>
              </View>
              <AdminButton label="Reinstate" variant="primary" disabled={busy} onPress={() => run((token) => adminModeration.setSuspended(token, entry.member.id, false))} />
            </View>
          ))}
        </View>
      )}
    </AdminScreen>
  );
}
