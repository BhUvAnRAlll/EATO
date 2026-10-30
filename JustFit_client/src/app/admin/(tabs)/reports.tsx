import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { useFocusEffect } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { AuthImage } from "@/components/community/AuthImage";
import { Avatar } from "@/components/community/Avatar";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { adminPortal, ago, type ReportGroup } from "@/lib/adminPortal";
import { adminModeration } from "@/lib/community";
import { useSessionToken } from "@/lib/session";
import { useCommunityStore } from "@/store/community";
import { colors } from "@/theme";

// Super Admin › Reports: members' reports grouped by the post, comment or story they're about,
// with every reason and who gave it. Remove deletes the content, Dismiss keeps it; either closes
// all of its reports and is logged. Suspend hides the author's posts everywhere (see Users).

type Tab = "open" | "resolved";
type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; groups: ReportGroup[]; counts: Record<Tab, number>; loadedAt: number };
type Pending = { kind: "remove" | "suspend"; group: ReportGroup } | null;

const firstName = (name: string) => name.split(/\s+/)[0] ?? name;

export default function AdminReports() {
  const getToken = useSessionToken();
  const setToken = useCommunityStore((state) => state.setToken);
  const [tab, setTab] = useState<Tab>("open");
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  const refresh = useCallback(async () => {
    const token = await getToken().catch(() => null);
    setToken(token); // reported photos load with the session token
    const result = await adminPortal.reports(token, tab);
    setLoad(result.ok ? { state: "ready", groups: result.data.groups, counts: { open: result.data.counts.open ?? 0, resolved: result.data.counts.resolved ?? 0 }, loadedAt: Date.now() } : { state: "failed", error: result.error });
  }, [getToken, setToken, tab]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const resolve = async (group: ReportGroup, action: "remove" | "dismiss") => {
    setBusy(true);
    setError(null);
    const result = await adminPortal.resolveReports(await getToken().catch(() => null), group.type, group.id, action);
    setBusy(false);
    setPending(null);
    if (!result.ok) return setError(result.error);
    await refresh();
  };

  const setSuspended = async (group: ReportGroup, suspended: boolean) => {
    setBusy(true);
    setError(null);
    const result = await adminModeration.setSuspended(await getToken().catch(() => null), group.author.id, suspended);
    setBusy(false);
    setPending(null);
    if (!result.ok) return setError(result.error);
    await refresh();
  };

  const counts = load.state === "ready" ? load.counts : { open: 0, resolved: 0 };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 110, gap: 14 }} showsVerticalScrollIndicator={false}>
          <View className="pt-2">
            <Text className="type-overline text-muted">justFit admin</Text>
            <Text className="type-title text-forest-ink">Reports</Text>
          </View>
          <View className="flex-row rounded-full bg-cream-tab p-1" accessibilityRole="tablist">
            {(["open", "resolved"] as Tab[]).map((t) => (
              <Pressable key={t} onPress={() => { setTab(t); setLoad({ state: "loading" }); }} className={tab === t ? "admin-segment admin-segment--on" : "admin-segment"} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} accessibilityLabel={t === "open" ? `Open reports, ${counts.open}` : `Resolved reports, ${counts.resolved}`}>
                <Text className={tab === t ? "admin-segment__label admin-segment__label--on" : "admin-segment__label"}>{`${t === "open" ? "Open" : "Resolved"} (${counts[t]})`}</Text>
              </Pressable>
            ))}
          </View>
          {error && <FormAlert message={error} />}

          {load.state === "loading" ? (
            <View className="items-center py-16"><ActivityIndicator color={colors.forest} /></View>
          ) : load.state === "failed" ? (
            <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load reports" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={() => { setLoad({ state: "loading" }); refresh(); }} />
          ) : load.groups.length === 0 ? (
            <DashedBlock icon={{ ios: "checkmark.shield", android: "verified_user", web: "verified_user" }} title={tab === "open" ? "No open reports" : "Nothing resolved yet"} text={tab === "open" ? "When members report a post, comment or story, it shows up here." : "Removed and dismissed reports show up here."} />
          ) : (
            load.groups.map((g) => (
              <View key={g.key} className="admin-list gap-3" style={{ padding: 16 }} accessibilityLabel={`Reported ${g.type} by ${g.author.name}`}>
                <View className="flex-row items-center gap-3">
                  <Avatar member={{ id: g.author.id, name: g.author.name, initial: g.author.name.charAt(0).toUpperCase() }} size={40} />
                  <View className="min-w-0 flex-1">
                    <Text className="card__title" numberOfLines={1}>{g.author.name}</Text>
                    <Text className="post__time" numberOfLines={1}>{[g.where, ago(g.postedAt, load.loadedAt)].filter(Boolean).join(" · ")}</Text>
                  </View>
                  {g.outcome && (
                    <View className="workout__pill" style={{ backgroundColor: g.outcome === "removed" ? colors.dangerSoft : colors.creamTab }}>
                      <Text className="workout__pill-label" style={{ color: colors.ink }}>{g.outcome === "removed" ? "Removed" : "Dismissed"}</Text>
                    </View>
                  )}
                </View>
                <View className="flex-row gap-3">
                  <Text className="type-body text-forest-ink min-w-0 flex-1">{g.body || (g.deleted ? "(deleted)" : "(no text)")}</Text>
                  {g.imageUrl && <AuthImage path={g.imageUrl} style={{ width: 72, height: 72, borderRadius: 12 }} />}
                </View>
                <View className="admin-flag">
                  <SymbolView name={{ ios: "flag", android: "flag", web: "flag" }} size={14} tintColor={colors.danger} />
                  <Text className="admin-flag__text">{`${g.count} ${g.count === 1 ? "report" : "reports"}: ${g.reports.map((r) => `${r.reason} (${firstName(r.reporter)})`).join(", ")}`}</Text>
                </View>
                {tab === "open" && (
                  <>
                    {g.authorSuspended ? (
                      <Pressable onPress={() => setSuspended(g, false)} disabled={busy} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Reinstate ${g.author.name}`}>
                        <Text className="home__link">{`${firstName(g.author.name)} is suspended · Reinstate`}</Text>
                      </Pressable>
                    ) : (
                      <Pressable onPress={() => setPending({ kind: "suspend", group: g })} disabled={busy} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Suspend ${g.author.name}`}>
                        <Text className="home__link">{`Suspend ${firstName(g.author.name)}`}</Text>
                      </Pressable>
                    )}
                    <View className="flex-row gap-3">
                      <Pressable onPress={() => resolve(g, "dismiss")} disabled={busy} className="btn-outline flex-1" accessibilityRole="button" accessibilityLabel={`Dismiss reports on ${g.author.name}'s ${g.type}`}>
                        <Text className="btn-outline__label">Dismiss</Text>
                      </Pressable>
                      <Pressable onPress={() => setPending({ kind: "remove", group: g })} disabled={busy} className="admin-danger-button flex-1" accessibilityRole="button" accessibilityLabel={`Remove ${g.author.name}'s ${g.type}`}>
                        <Text className="admin-danger-button__label">Remove</Text>
                      </Pressable>
                    </View>
                  </>
                )}
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
      <ConfirmSheet
        visible={pending !== null}
        title={pending?.kind === "suspend" ? `Suspend ${pending.group.author.name}?` : `Remove this ${pending?.group.type ?? "post"}?`}
        text={pending?.kind === "suspend" ? "Their posts disappear from everyone else's feeds. You can reinstate them from Users." : "It's deleted for everyone and its reports are closed. This can't be undone here."}
        confirmLabel={pending?.kind === "suspend" ? "Suspend" : "Remove"}
        busy={busy}
        onConfirm={() => pending && (pending.kind === "suspend" ? setSuspended(pending.group, true) : resolve(pending.group, "remove"))}
        onCancel={() => setPending(null)}
      />
    </View>
  );
}
