import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";

import { AdminScreen } from "@/components/admin/AdminScreen";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { ISSUE_CATEGORY_LABEL, ISSUE_STATUS_LABEL } from "@/data/issues";
import { issuesApi, type IssueStatus } from "@/lib/issuesApi";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

const STATUSES: (IssueStatus | null)[] = [null, "open", "in_progress", "resolved", "rejected"];
const ago = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// Super Admin › Meals › Issues (Meal Operations phase 6): members' reports on orders and plans,
// open ones first; filter by status (with counts) and search by member, number or words. A row
// opens the issue to work it.
export default function AdminIssues() {
  const colors = useThemeColors();
  const [status, setStatus] = useState<IssueStatus | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const load = useCallback((t: string | null) => issuesApi.list(t, status, query), [status, query]);
  const { result, retry, refresh } = useGymData(load);
  const data = result.state === "ready" ? result.data : null;
  const total = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : null;

  return (
    <AdminScreen title="Issues" onRefresh={refresh}>
      <View style={{ gap: 14 }}>
        <View className="search search--pill search--on-page">
          <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
          <TextInput className="search__input" value={search} onChangeText={setSearch} placeholder="Member, number or words" placeholderTextColor={colors.faint} autoCorrect={false} maxLength={40} accessibilityLabel="Search issues" />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {STATUSES.map((s) => {
            const on = status === s;
            const n = data ? (s === null ? total : data.counts[s]) : null;
            return (
              <Pressable key={s ?? "all"} onPress={() => setStatus(s)} className={on ? "filter-chip filter-chip--selected" : "filter-chip"} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                <Text className={on ? "filter-chip__label filter-chip__label--selected" : "filter-chip__label"}>{`${s ? ISSUE_STATUS_LABEL[s] : "All"}${n === null ? "" : ` · ${n}`}`}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {result.state === "loading" && <ScreenSkeleton label="Loading issues" />}
        {result.state === "failed" && (
          <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load issues" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
        )}
        {data && data.issues.length === 0 && <DashedBlock icon={{ ios: "checkmark.seal", android: "verified", web: "verified" }} title="Nothing here" text="Members' reports on orders and meal plans show up here." />}
        {data && data.issues.length > 0 && (
          <View className="admin-list">
            {data.issues.map((i, n) => (
              <Pressable key={i.id} onPress={() => router.push({ pathname: "/admin/issues/[id]", params: { id: String(i.id) } })} className={n === 0 ? "admin-row" : "admin-row admin-row--divided"} accessibilityRole="button">
                <View className="min-w-0 flex-1">
                  <Text className="card__title" numberOfLines={1}>{`${i.code} · ${ISSUE_CATEGORY_LABEL[i.category]}`}</Text>
                  <Text className="meta-text" numberOfLines={1}>{`${i.member?.name ?? "Member"} · ${i.orderCode ? `order #${i.orderCode}` : "meal plan"} · ${ago(i.createdAt)}`}</Text>
                  <Text className="meta-text" numberOfLines={1}>{i.description}</Text>
                </View>
                <Text className="meta-text" style={{ color: i.status === "open" ? colors.danger : colors.muted }}>{ISSUE_STATUS_LABEL[i.status]}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </AdminScreen>
  );
}
