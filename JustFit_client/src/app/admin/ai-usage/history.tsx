import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { usePullToRefresh } from "@/components/PullToRefresh";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { SymbolView } from "@/components/SymbolView";
import { FEATURE_SHORT, PROVIDER_LABEL, STATUS_LABEL } from "@/data/aiUsage";
import { aiUsage, compact, inr, type AiFeature, type AiStatus, type HistoryFilters, type HistoryPage, type HistorySort } from "@/lib/aiUsage";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; data: HistoryPage };

// The gym assistant last, for its calls from before gyms were removed
const FEATURES: AiFeature[] = ["coach_plan", "coach_workout", "coach_meal", "coach_chat", "food_scan", "body_scan", "body_report", "exercise_library", "gym_assistant"];
const STATUSES: AiStatus[] = ["ok", "failed", "refused"];
const SORTS: { id: HistorySort; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "cost", label: "Cost" },
  { id: "tokens", label: "Tokens" },
];

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/ai-usage"));
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// Super Admin › AI Usage › Usage history: every AI call, 25 to a page, searched by account or
// model and filtered by feature and outcome. The server does the filtering and sorting.
export default function AiUsageHistory() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<HistoryFilters>({ search: "", feature: null, status: null, sort: "newest", page: 1 });
  const [load, setLoad] = useState<Load>({ state: "loading" });

  // Typing waits half a second before it searches
  useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => (f.search === search.trim() ? f : { ...f, search: search.trim(), page: 1 })), 500);
    return () => clearTimeout(timer);
  }, [search]);

  // One page of the history for some filters, as a load state
  const read = useCallback(async (f: HistoryFilters): Promise<Load> => {
    const result = await aiUsage.history(await getToken().catch(() => null), f);
    return result.ok ? { state: "ready", data: result.data } : { state: "failed", error: result.error };
  }, [getToken]);

  useEffect(() => {
    let cancelled = false;
    read(filters).then((next) => {
      if (!cancelled) setLoad(next);
    });
    return () => {
      cancelled = true;
    };
  }, [filters, read]);

  const change = (patch: Partial<HistoryFilters>) => {
    setLoad({ state: "loading" });
    setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
  };

  // A pull goes back to the first page with the filters as they are: read in place on page 1,
  // otherwise the page change loads it the way Previous and Next do
  const reload = useCallback(async () => {
    if (filters.page === 1) return setLoad(await read(filters));
    setLoad({ state: "loading" });
    setFilters((f) => ({ ...f, page: 1 }));
  }, [filters, read]);
  const { refreshControl } = usePullToRefresh(reload);

  const pages = load.state === "ready" ? Math.max(1, Math.ceil(load.data.total / load.data.pageSize)) : 1;

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title" accessibilityRole="header">Usage history</Text>
          <View className="screen-bar__spacer" />
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"} refreshControl={refreshControl}>
          <View className="search search--pill">
            <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
            <TextInput
              className="search__input"
              value={search}
              onChangeText={setSearch}
              placeholder="Member, account id or model"
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={80}
              returnKeyType="search"
              onSubmitEditing={() => change({ search: search.trim() })}
              accessibilityLabel="Search usage"
            />
          </View>

          <Chips
            label="Feature"
            options={[{ id: "", label: "All" }, ...FEATURES.map((f) => ({ id: f, label: FEATURE_SHORT[f] }))]}
            value={filters.feature ?? ""}
            onPick={(id) => change({ feature: (id || null) as AiFeature | null })}
          />
          <Chips
            label="Status"
            options={[{ id: "", label: "All" }, ...STATUSES.map((s) => ({ id: s, label: STATUS_LABEL[s] }))]}
            value={filters.status ?? ""}
            onPick={(id) => change({ status: (id || null) as AiStatus | null })}
          />
          <Chips label="Sort" options={SORTS} value={filters.sort} onPick={(id) => change({ sort: id as HistorySort })} />

          {load.state === "loading" ? (
            <View className="items-center py-12"><ActivityIndicator color={colors.leaf} /></View>
          ) : load.state === "failed" ? (
            <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the history" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={() => change({})} />
          ) : load.data.rows.length === 0 ? (
            <DashedBlock icon={{ ios: "tray", android: "inbox", web: "inbox" }} title="No calls match" text="Try another search or clear a filter." />
          ) : (
            <>
              <Text className="meta-text">{`${load.data.total.toLocaleString("en-US")} ${load.data.total === 1 ? "call" : "calls"} · page ${load.data.page} of ${pages}`}</Text>
              <View className="admin-list">
                {load.data.rows.map((row, i) => (
                  <View
                    key={row.id}
                    className={i === 0 ? "px-4 py-3" : "border-t border-cream-line px-4 py-3"}
                    style={{ gap: 2 }}
                    accessibilityLabel={`${when(row.at)}, ${FEATURE_SHORT[row.feature]}, ${row.userName ?? row.userId ?? "no account"}, ${row.model}, ${row.totalTokens} tokens, ${inr(row.costInr)}, ${STATUS_LABEL[row.status]}`}
                  >
                    <View className="ai-kv">
                      <Text className="card__title" numberOfLines={1}>{`${when(row.at)} · ${FEATURE_SHORT[row.feature]}`}</Text>
                      <View className="workout__pill" style={{ backgroundColor: row.status === "ok" ? colors.successSoft : row.status === "failed" ? colors.dangerSoft : colors.warningSoft }}>
                        <Text className="workout__pill-label" style={{ color: colors.ink }}>{STATUS_LABEL[row.status]}</Text>
                      </View>
                    </View>
                    <Text className="meta-text" numberOfLines={1}>{`${row.userName ?? row.userId ?? (row.gymId ? "WhatsApp contact" : "No account")} · ${row.model} (${PROVIDER_LABEL[row.provider]})`}</Text>
                    <View className="ai-kv">
                      <Text className="ai-kv__key">{`in ${compact(row.inputTokens)} · out ${compact(row.outputTokens)} · ${compact(row.totalTokens)} tokens`}</Text>
                      <Text className="ai-kv__value">{inr(row.costInr)}</Text>
                    </View>
                  </View>
                ))}
              </View>
              {pages > 1 && (
                <View className="flex-row gap-2">
                  <Pressable onPress={() => change({ page: filters.page - 1 })} disabled={filters.page <= 1} className="btn-outline flex-1" style={{ opacity: filters.page <= 1 ? 0.4 : 1 }} accessibilityRole="button" accessibilityLabel="Previous page">
                    <Text className="btn-outline__label">Previous</Text>
                  </Pressable>
                  <Pressable onPress={() => change({ page: filters.page + 1 })} disabled={filters.page >= pages} className="btn-outline flex-1" style={{ opacity: filters.page >= pages ? 0.4 : 1 }} accessibilityRole="button" accessibilityLabel="Next page">
                    <Text className="btn-outline__label">Next</Text>
                  </Pressable>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Chips({ label, options, value, onPick }: { label: string; options: { id: string; label: string }[]; value: string; onPick: (id: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: "center" }} accessibilityRole="tablist" accessibilityLabel={label}>
      <Text className="ai-kv__key">{label}</Text>
      {options.map((option) => {
        const on = option.id === value;
        return (
          <Pressable key={option.id || "all"} onPress={() => onPick(option.id)} className={on ? "filter-chip filter-chip--selected" : "filter-chip"} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${label}: ${option.label}`}>
            <Text className={on ? "filter-chip__label filter-chip__label--selected" : "filter-chip__label"}>{option.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
