import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect } from "expo-router";

import { usePullToRefresh } from "@/components/PullToRefresh";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { SymbolView } from "@/components/SymbolView";
import { appUsage, MEMBER_SORT_LABEL, MEMBER_SORTS, type MemberList, type MemberSort } from "@/lib/appUsage";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; data: MemberList };

const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/app-usage"));

// Super Admin › App Usage › Members: each member's last active day, sessions (once tracked),
// interactions, active days and most-used feature; searchable by name or id, sortable, paged.
// Names are shown to admins only; no contact details appear here.
export default function MembersUsageScreen() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [sort, setSort] = useState<MemberSort>("last_active");
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [load, setLoad] = useState<Load>({ state: "loading" });

  // The search applies a moment after typing stops
  useEffect(() => {
    const t = setTimeout(() => { setSearch(typed.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [typed]);

  const refresh = useCallback(async () => {
    const result = await appUsage.members(await getToken().catch(() => null), { sort, search, page });
    setLoad(result.ok ? { state: "ready", data: result.data } : { state: "failed", error: result.error });
  }, [getToken, sort, search, page]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const pickSort = (s: MemberSort) => { setSort(s); setPage(1); setLoad({ state: "loading" }); };

  // A pull goes back to the first page with the sort and search as they are: read in place on
  // page 1, otherwise the page change loads it the way Previous and Next do
  const reload = useCallback(async () => {
    if (page === 1) return refresh();
    setPage(1);
    setLoad({ state: "loading" });
  }, [page, refresh]);
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
          <Text className="screen-bar__title" accessibilityRole="header">Members</Text>
          <View style={{ width: 44 }} />
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"} refreshControl={refreshControl}>
          <TextInput value={typed} onChangeText={setTyped} placeholder="Search by name or member id" placeholderTextColor={colors.faint} className="admin__input" accessibilityLabel="Search members" autoCapitalize="none" autoCorrect={false} />
          <View className="flex-row flex-wrap" style={{ gap: 8 }} accessibilityRole="tablist">
            {MEMBER_SORTS.map((s) => (
              <Pressable key={s} onPress={() => pickSort(s)} className={sort === s ? "admin-chip admin-chip--on" : "admin-chip"} accessibilityRole="tab" accessibilityState={{ selected: sort === s }} accessibilityLabel={`Sort by ${MEMBER_SORT_LABEL[s]}`}>
                <Text className={sort === s ? "admin-segment__label admin-segment__label--on" : "admin-segment__label"}>{MEMBER_SORT_LABEL[s]}</Text>
              </Pressable>
            ))}
          </View>

          {load.state === "loading" ? (
            <View className="items-center gap-3 py-16">
              <ActivityIndicator color={colors.leaf} />
              <Text className="home__note">Loading</Text>
            </View>
          ) : load.state === "failed" ? (
            <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load members" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={() => { setLoad({ state: "loading" }); refresh(); }} />
          ) : load.data.members.length === 0 ? (
            <DashedBlock icon={{ ios: "person.2", android: "group", web: "group" }} title="No members found" text={search ? `Nobody matches "${search}".` : "No members yet."} />
          ) : (
            <>
              <Text className="home__note">{`${load.data.total} ${load.data.total === 1 ? "member" : "members"}${load.data.sessionsTracked ? "" : " · sessions show once the app's event tracking is set up"}`}</Text>
              <View className="admin-list">
                {load.data.members.map((m, i) => (
                  <View key={m.id} className={i > 0 ? "admin-row admin-row--divided" : "admin-row"} accessibilityLabel={`${m.name}: last active ${m.lastActive ?? "never"}, ${m.interactions} interactions over ${m.activeDays} active days${m.sessions !== null ? `, ${m.sessions} sessions` : ""}${m.mostUsed ? `, most used ${m.mostUsed.label}` : ""}`}>
                    <View className="min-w-0 flex-1" style={{ gap: 2 }}>
                      <View className="ai-kv">
                        <Text className="card__title" numberOfLines={1}>{m.name}</Text>
                        <Text className="ai-kv__value">{m.lastActive ? `Active ${m.lastActive}` : "Never active"}</Text>
                      </View>
                      <Text className="meta-text" numberOfLines={1}>{`${m.interactions} interactions · ${m.activeDays} active ${m.activeDays === 1 ? "day" : "days"}${m.sessions !== null ? ` · ${m.sessions} sessions` : ""}`}</Text>
                      <Text className="meta-text" numberOfLines={1}>{m.mostUsed ? `Most used: ${m.mostUsed.label} (${m.mostUsed.uses})` : "Hasn't used a feature yet"}</Text>
                    </View>
                  </View>
                ))}
              </View>
              {pages > 1 && (
                <View className="flex-row items-center justify-between">
                  <Pressable onPress={() => { setPage((p) => Math.max(1, p - 1)); setLoad({ state: "loading" }); }} disabled={page <= 1} className="admin__action" accessibilityRole="button" accessibilityState={{ disabled: page <= 1 }}>
                    <Text className="admin__action-label">Previous</Text>
                  </Pressable>
                  <Text className="meta-text">{`Page ${page} of ${pages}`}</Text>
                  <Pressable onPress={() => { setPage((p) => Math.min(pages, p + 1)); setLoad({ state: "loading" }); }} disabled={page >= pages} className="admin__action" accessibilityRole="button" accessibilityState={{ disabled: page >= pages }}>
                    <Text className="admin__action-label">Next</Text>
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
