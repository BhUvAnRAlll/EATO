import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router } from "expo-router";

import { EmptyState } from "@/components/community/CommunityStates";
import { GymCard } from "@/components/community/GymCard";
import { FormAlert } from "@/components/FormAlert";
import { isOffline } from "@/lib/community";
import { gyms, type Gym } from "@/lib/gyms";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

type Filter = "all" | "join" | "request";
const filters: { key: Filter; label: string }[] = [
  { key: "all", label: "All gyms" },
  { key: "join", label: "Open to join" },
  { key: "request", label: "Approval required" },
];

// Explore Gyms (View All on the Gyms tab): every gym you can see, yours first, searchable by
// name or area and filtered by how a gym takes new members. Hidden gyms never appear here.
export default function ExploreGyms() {
  const getToken = useSessionToken();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [list, setList] = useState<Gym[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await gyms.list(await getToken(), search.trim() || null);
    if (result.ok) {
      setList([...result.data.mine, ...result.data.explore]);
      setError(null);
    } else setError(result.error);
  }, [search, getToken]);

  // Loads at once, and as the search is typed (debounced)
  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const act = async (gym: Gym, action: "join" | "request" | "cancel") => {
    setBusyId(gym.id);
    const token = await getToken();
    const result = action === "cancel" ? await gyms.leave(token, gym.id) : await gyms.join(token, gym.id);
    if (result.ok) await load();
    else setError(result.error);
    setBusyId(null);
  };

  const shown = (list ?? []).filter((gym) => filter === "all" || gym.joinMode === filter);
  const searching = search.trim() !== "";

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View className="screen-bar">
          <Pressable onPress={() => router.back()} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title">Explore Gyms</Text>
          <View className="screen-bar__spacer" />
        </View>
        <FlatList
          data={shown}
          keyExtractor={(gym) => gym.id}
          ListHeaderComponent={
            <View className="pb-3">
              <View className="search search--pill mx-5 mt-4">
                <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
                <TextInput className="search__input" value={search} onChangeText={setSearch} placeholder="Search by name or area" placeholderTextColor={colors.faint} autoCorrect={false} accessibilityLabel="Search gyms" />
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3" contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }} accessibilityRole="tablist">
                {filters.map((item) => {
                  const selected = filter === item.key;
                  return (
                    <Pressable key={item.key} onPress={() => setFilter(item.key)} className={selected ? "friend-chip friend-chip--selected" : "friend-chip"} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={item.label}>
                      <Text className={selected ? "friend-chip__label friend-chip__label--selected" : "friend-chip__label"}>{item.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              {list !== null && <Text className="home__note mx-5 mt-3">{shown.length === 1 ? "1 gym" : `${shown.length} gyms`}{searching ? ` matching "${search.trim()}"` : ""}</Text>}
              {error && list !== null && (
                <Pressable onPress={() => setError(null)} className="mx-5 mt-3">
                  <FormAlert message={error} />
                </Pressable>
              )}
            </View>
          }
          ListEmptyComponent={
            <View className="px-5">
              {list === null ? (
                error ? (
                  <EmptyState icon={isOffline(error) ? { ios: "wifi.slash", android: "wifi_off", web: "wifi_off" } : { ios: "exclamationmark.triangle", android: "error_outline", web: "error_outline" }} title={isOffline(error) ? "You're offline" : "Couldn't load gyms"} text={error} actionLabel="Retry" onAction={load} />
                ) : (
                  <ActivityIndicator color={colors.forest} className="mt-6" />
                )
              ) : (
                <EmptyState icon={{ ios: "magnifyingglass", android: "search", web: "search" }} title="No gyms found" text={searching ? "Try another name or area." : "Try another filter."} />
              )}
            </View>
          }
          renderItem={({ item }) => (
            <View className="px-5 pb-3">
              <GymCard gym={item} busy={busyId === item.id} onOpen={() => router.push({ pathname: "/community/gyms/[id]", params: { id: item.id } })} onAction={(action) => act(item, action)} />
            </View>
          )}
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.forest} />}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />
      </SafeAreaView>
    </View>
  );
}
