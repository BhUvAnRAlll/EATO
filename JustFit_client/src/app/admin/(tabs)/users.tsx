import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect } from "expo-router";

import { usePullToRefresh } from "@/components/PullToRefresh";
import { ScreenSkeleton } from "@/components/Skeleton";
import { Avatar } from "@/components/Avatar";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { KIND_LABEL, adminPortal, type AdminUserRow, type UserFilter } from "@/lib/adminPortal";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

// Super Admin › Users: every account, searched by name or email and filtered by kind. Each row
// opens the account's page (when they joined and what they logged).

const FILTERS: { value: UserFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "members", label: "Members" },
  { value: "admins", label: "Admins" },
];

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; users: AdminUserRow[] };

// The server answers at most this many rows; past it the list says to search
const PAGE_CAP = 200;

export default function AdminUsers() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [filter, setFilter] = useState<UserFilter>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [load, setLoad] = useState<Load>({ state: "loading" });
  // Only the newest read may land: an older search's answer arriving late can't overwrite it
  const latest = useRef(0);

  // Search a moment after typing stops, not on every key
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const refresh = useCallback(async () => {
    const call = ++latest.current;
    const result = await adminPortal.users(await getToken().catch(() => null), filter, query);
    if (call !== latest.current) return;
    setLoad(result.ok ? { state: "ready", users: result.data.users } : { state: "failed", error: result.error });
  }, [getToken, filter, query]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );
  const { refreshControl } = usePullToRefresh(refresh);

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScrollView contentContainerStyle={{ paddingBottom: 110, gap: 14 }} keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"} showsVerticalScrollIndicator={false} refreshControl={refreshControl}>
          <View className="px-5 pt-2">
            <Text className="type-overline text-muted">justFit admin</Text>
            <Text className="type-title text-forest-ink">Users</Text>
          </View>
          <View className="search search--pill mx-5">
            <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
            <TextInput className="search__input" value={search} onChangeText={setSearch} placeholder="Name or email" placeholderTextColor={colors.faint} autoCorrect={false} autoCapitalize="none" maxLength={80} accessibilityLabel="Search users" />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }} accessibilityRole="tablist">
            {FILTERS.map((f) => {
              const selected = filter === f.value;
              return (
                <Pressable key={f.value} onPress={() => setFilter(f.value)} className={selected ? "filter-chip filter-chip--selected" : "filter-chip"} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={f.label}>
                  <Text className={selected ? "filter-chip__label filter-chip__label--selected" : "filter-chip__label"}>{f.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View className="px-5">
            {load.state === "loading" ? (
              <ScreenSkeleton label="Loading users" />
            ) : load.state === "failed" ? (
              <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load users" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={() => { setLoad({ state: "loading" }); refresh(); }} />
            ) : load.users.length === 0 ? (
              <DashedBlock icon={{ ios: "person.crop.circle.badge.questionmark", android: "person_search", web: "person_search" }} title="Nobody matches" text={query ? `No account matches "${query}".` : "No accounts in this group."} />
            ) : (
              <View style={{ gap: 10 }}>
                {load.users.length >= PAGE_CAP && <Text className="meta-text">{`Showing the first ${PAGE_CAP}. Search to narrow.`}</Text>}
              <View className="admin-list">
                {load.users.map((u, i) => {
                  const detail = KIND_LABEL[u.kind];
                  return (
                    <Pressable
                      key={u.id}
                      onPress={() => router.push({ pathname: "/admin/users/[userId]", params: { userId: u.id } })}
                      className={i === 0 ? "admin-row" : "admin-row admin-row--divided"}
                      accessibilityRole="button"
                      accessibilityLabel={`${u.name}, ${detail}`}
                    >
                      <Avatar member={{ id: u.id, name: u.name, initial: u.name.charAt(0).toUpperCase() }} size={44} />
                      <View className="min-w-0 flex-1">
                        <Text className="card__title" numberOfLines={1}>{u.name}</Text>
                        <Text className="meta-text" numberOfLines={1}>{detail}</Text>
                      </View>
                      <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
                    </Pressable>
                  );
                })}
              </View>
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
