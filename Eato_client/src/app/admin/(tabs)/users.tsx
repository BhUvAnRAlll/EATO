import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect } from "expo-router";

import { Avatar } from "@/components/community/Avatar";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { KIND_LABEL, adminPortal, type AdminUserRow, type UserFilter } from "@/lib/adminPortal";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

// Super Admin › Users: every account, searched by name or email and filtered by kind. Each row
// opens the account's page (posts, reports, gyms, trainer verification, suspension).

const FILTERS: { value: UserFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "members", label: "Members" },
  { value: "trainers", label: "Trainers" },
  { value: "owners", label: "Gym owners" },
  { value: "suspended", label: "Suspended" },
];

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; users: AdminUserRow[] };

export default function AdminUsers() {
  const getToken = useSessionToken();
  const [filter, setFilter] = useState<UserFilter>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [load, setLoad] = useState<Load>({ state: "loading" });

  // Search a moment after typing stops, not on every key
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const refresh = useCallback(async () => {
    const result = await adminPortal.users(await getToken().catch(() => null), filter, query);
    setLoad(result.ok ? { state: "ready", users: result.data.users } : { state: "failed", error: result.error });
  }, [getToken, filter, query]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScrollView contentContainerStyle={{ paddingBottom: 110, gap: 14 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View className="px-5 pt-2">
            <Text className="type-overline text-muted">JustFit admin</Text>
            <Text className="type-title text-forest-ink">Users</Text>
          </View>
          <View className="search search--pill mx-5">
            <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
            <TextInput className="search__input" value={search} onChangeText={setSearch} placeholder="Name or email" placeholderTextColor={colors.faint} autoCorrect={false} autoCapitalize="none" maxLength={80} accessibilityLabel="Search users" />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }} accessibilityRole="tablist">
            {FILTERS.map((f) => {
              const selected = filter === f.value;
              return (
                <Pressable key={f.value} onPress={() => setFilter(f.value)} className={selected ? "friend-chip friend-chip--selected" : "friend-chip"} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={f.label}>
                  <Text className={selected ? "friend-chip__label friend-chip__label--selected" : "friend-chip__label"}>{f.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View className="px-5">
            {load.state === "loading" ? (
              <View className="items-center py-16"><ActivityIndicator color={colors.forest} /></View>
            ) : load.state === "failed" ? (
              <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load users" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={() => { setLoad({ state: "loading" }); refresh(); }} />
            ) : load.users.length === 0 ? (
              <DashedBlock icon={{ ios: "person.crop.circle.badge.questionmark", android: "person_search", web: "person_search" }} title="Nobody matches" text={query ? `No account matches "${query}".` : "No accounts in this group."} />
            ) : (
              <View className="admin-list">
                {load.users.map((u, i) => {
                  const detail = [KIND_LABEL[u.kind], u.unverified ? "unverified" : null, u.suspended ? "suspended" : null].filter(Boolean).join(" · ");
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
                        <Text className="post__time" numberOfLines={1} style={u.suspended ? { color: colors.ink } : undefined}>{detail}</Text>
                      </View>
                      <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
