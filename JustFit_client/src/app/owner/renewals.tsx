import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { SymbolView } from "@/components/SymbolView";

import { ActionSheet } from "@/components/community/ActionSheet";
import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { FormAlert } from "@/components/FormAlert";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { daysLeftLabel, flagLabel, owner, type RenewalFlag, type RenewalRow } from "@/lib/owner";
import { useSessionToken } from "@/lib/session";
import { useOwnerStore } from "@/store/owner";
import { colors } from "@/theme";

type Filter = "all" | RenewalFlag;
const filters: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "expired", label: "Expired" },
  { key: "this_week", label: "This week" },
  { key: "this_month", label: "This month" },
  { key: "active", label: "Active" },
  { key: "none", label: "No package" },
];
const badgeClass: Record<RenewalFlag, string> = {
  expired: "owner-badge owner-badge--danger",
  this_week: "owner-badge owner-badge--warning",
  this_month: "owner-badge owner-badge--warning",
  active: "owner-badge owner-badge--accent",
  none: "owner-badge",
};

// Renewals: every member's package, soonest to end first, flagged Expired / This week / This
// month / Active. Tap a member to renew by 1 or 3 months (recorded only, no payment).
export default function OwnerRenewals() {
  const getToken = useSessionToken();
  const gymId = useOwnerStore((state) => state.gymId);
  const loadSummary = useOwnerStore((state) => state.loadSummary);
  const [rows, setRows] = useState<RenewalRow[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<RenewalRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!gymId) return;
    const result = await owner.renewals(await getToken(), gymId);
    if (result.ok) {
      setRows(result.data.members);
      setError(null);
    } else setError(result.error);
  }, [gymId, getToken]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);
  const { refreshControl } = usePullToRefresh(load);

  const renew = async (row: RenewalRow, months: 1 | 3) => {
    if (!gymId || busy) return;
    setBusy(true);
    setNotice(null);
    const token = await getToken();
    const result = await owner.renew(token, gymId, row.member.id, months);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setNotice(`${row.member.name}'s package now runs until ${result.data.plan.endsOn}. Recorded only: no payment was taken.`);
    await load();
    await loadSummary(token);
  };

  const remind = async (row: RenewalRow | null) => {
    if (!gymId || busy) return;
    setBusy(true);
    setNotice(null);
    const result = row ? await owner.remind(await getToken(), gymId, row.member.id) : await owner.remindDue(await getToken(), gymId);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setNotice(row ? `Reminder sent to ${row.member.name}.` : `Reminder sent to ${result.data.reach} ${result.data.reach === 1 ? "member" : "members"} expired or ending this week.`);
  };

  const shown = (rows ?? []).filter((row) => filter === "all" || row.flag === filter);
  const counts = (key: Filter) => (rows ?? []).filter((row) => key === "all" || row.flag === key).length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }} edges={["top", "left", "right"]}>
      <View className="screen-bar">
        <Pressable onPress={() => router.back()} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
          <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
        </Pressable>
        <Text className="screen-bar__title">Renewals</Text>
        <View className="screen-bar__spacer" />
      </View>
      <FlatList
        data={shown}
        keyExtractor={(row) => row.member.id}
        ListHeaderComponent={
          <View className="gap-3 pb-3">
            <Text className="owner__subtitle mx-5 mt-4">Members&apos; packages, soonest to end first. Renewing records the new end date; no payment is taken.</Text>
            <View className="mx-5 flex-row flex-wrap gap-2" accessibilityRole="tablist">
              {filters.map((item) => {
                const on = filter === item.key;
                const label = rows ? `${item.label} (${counts(item.key)})` : item.label;
                return (
                  <Pressable key={item.key} onPress={() => setFilter(item.key)} className={on ? "friend-chip friend-chip--selected" : "friend-chip"} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label}>
                    <Text className={on ? "friend-chip__label friend-chip__label--selected" : "friend-chip__label"}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable onPress={() => remind(null)} disabled={busy} className="owner-quick mx-5" style={{ alignSelf: "flex-start", opacity: busy ? 0.5 : 1 }} accessibilityRole="button" accessibilityLabel="Remind everyone due">
              <SymbolView name={{ ios: "bell", android: "notifications", web: "notifications" }} size={16} tintColor={colors.ink} />
              <Text className="owner-quick__label">Remind everyone due</Text>
            </Pressable>
            {notice && <Text className="friend-row__note mx-5" accessibilityLiveRegion="polite">{notice}</Text>}
            {error && rows && (
              <Pressable onPress={() => setError(null)} className="mx-5">
                <FormAlert message={error} />
              </Pressable>
            )}
          </View>
        }
        ListEmptyComponent={
          <View className="px-5 pt-2">
            {rows === null && !error ? (
              <ActivityIndicator color={colors.forest} />
            ) : error && !rows ? (
              <EmptyState icon={{ ios: "exclamationmark.triangle", android: "error_outline", web: "error_outline" }} title="Couldn't load" text={error} actionLabel="Retry" onAction={load} />
            ) : (
              <EmptyState icon={{ ios: "calendar", android: "event", web: "event" }} title="Nobody here" text={filter === "all" ? "Members who join your gym show here." : "No members in this group right now."} />
            )}
          </View>
        }
        renderItem={({ item, index }) => (
          <Pressable
            onPress={() => setSelected(item)}
            className={`friend-row mx-5 ${index === 0 ? "friend-row--first" : ""} ${index === shown.length - 1 ? "friend-row--last" : ""}`}
            accessibilityRole="button"
            accessibilityLabel={`${item.member.name}, ${flagLabel[item.flag]}, ${daysLeftLabel(item.daysLeft)}. Renew`}
          >
            <Avatar member={item.member} size={40} />
            <View className="min-w-0 flex-1">
              <Text className="friend-row__name" numberOfLines={1}>{item.member.name}</Text>
              <Text className="friend-row__note" numberOfLines={1}>
                {item.plan ? `${item.plan.name} · ${daysLeftLabel(item.daysLeft)}` : daysLeftLabel(null)}
              </Text>
            </View>
            <View className={badgeClass[item.flag]}>
              <Text className="owner-badge__label">{flagLabel[item.flag]}</Text>
            </View>
          </Pressable>
        )}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={refreshControl}
      />
      <ActionSheet
        visible={selected !== null}
        title={selected ? `Renew ${selected.member.name}` : undefined}
        actions={
          selected
            ? [
                { label: "Renew for 1 month", onPress: () => renew(selected, 1) },
                { label: "Renew for 3 months", onPress: () => renew(selected, 3) },
                { label: "Send renewal reminder", onPress: () => remind(selected) },
              ]
            : []
        }
        onClose={() => setSelected(null)}
      />
    </SafeAreaView>
  );
}
