import { useCallback, useEffect, useState, type ReactElement } from "react";
import { ActivityIndicator, Pressable, RefreshControl, SectionList, Text, TextInput, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { router } from "expo-router";

import { EmptyState } from "@/components/community/CommunityStates";
import { GymCard } from "@/components/community/GymCard";
import { FormAlert } from "@/components/FormAlert";
import { isOffline } from "@/lib/community";
import { gyms, type Gym } from "@/lib/gyms";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

// The Gyms tab: My Gyms (any status) and Explore Gyms, with a search and a way in by code.
// `header` is the Community header, drawn above so the page scrolls as one.
export function GymsPanel({ header }: { header: ReactElement }) {
  const getToken = useSessionToken();
  const [search, setSearch] = useState("");
  const [lists, setLists] = useState<{ mine: Gym[]; explore: Gym[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await gyms.list(await getToken(), search.trim() || null);
    if (result.ok) {
      setLists(result.data);
      setError(null);
    } else setError(result.error);
  }, [search, getToken]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Join, ask to join, or withdraw a request; the server answers with the gym as it now stands
  const act = async (gym: Gym, action: "join" | "request" | "cancel") => {
    setBusyId(gym.id);
    const token = await getToken();
    const result = action === "cancel" ? await gyms.leave(token, gym.id) : await gyms.join(token, gym.id);
    if (result.ok) await load();
    else setError(result.error);
    setBusyId(null);
  };

  const open = (gym: Gym) => router.push({ pathname: "/community/gyms/[id]", params: { id: gym.id } });

  const sections = lists
    ? [
        ...(lists.mine.length > 0 ? [{ key: "mine", title: "My Gyms", data: lists.mine }] : []),
        { key: "explore", title: search.trim() ? "Results" : "Explore Gyms", data: lists.explore },
      ]
    : [];

  return (
    <SectionList
      sections={sections}
      keyExtractor={(gym) => gym.id}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <View className="pb-2">
          {header}
          <View className="search mx-5 mt-5">
            <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
            <TextInput className="search__input" value={search} onChangeText={setSearch} placeholder="Search gyms by name or area" placeholderTextColor={colors.faint} autoCorrect={false} accessibilityLabel="Search gyms" />
          </View>
          <Pressable onPress={() => router.push("/community/gyms/join")} className="composer mx-5 mt-3" accessibilityRole="button" accessibilityLabel="Join a gym with an invite code">
            <View className="group__tile">
              <SymbolView name={{ ios: "qrcode", android: "qr_code", web: "qr_code" }} size={22} tintColor={colors.leaf} />
            </View>
            <Text className="composer__prompt">Have an invite code? Join a gym</Text>
            <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={16} tintColor={colors.muted} />
          </Pressable>
          {error && lists !== null && (
            <Pressable onPress={() => setError(null)} className="mx-5 mt-3">
              <FormAlert message={error} />
            </Pressable>
          )}
        </View>
      }
      renderSectionHeader={({ section }) => <Text className="setup__section mx-5 mb-2 mt-4">{section.title}</Text>}
      renderItem={({ item }) => (
        <View className="px-5 pb-3">
          <GymCard gym={item} busy={busyId === item.id} onOpen={() => open(item)} onAction={(action) => act(item, action)} />
        </View>
      )}
      renderSectionFooter={({ section }) =>
        section.key === "explore" && section.data.length === 0 ? (
          <View className="px-5">
            <EmptyState icon={{ ios: "dumbbell", android: "fitness_center", web: "fitness_center" }} title={search.trim() ? "No gyms found" : "No other gyms yet"} text={search.trim() ? "Try another name or area." : "Gyms you can join will appear here."} />
          </View>
        ) : null
      }
      ListEmptyComponent={
        lists === null ? (
          error ? (
            <View className="px-5">
              <EmptyState icon={isOffline(error) ? { ios: "wifi.slash", android: "wifi_off", web: "wifi_off" } : { ios: "exclamationmark.triangle", android: "error_outline", web: "error_outline" }} title={isOffline(error) ? "You're offline" : "Couldn't load gyms"} text={error} actionLabel="Retry" onAction={load} />
            </View>
          ) : (
            <ActivityIndicator color={colors.forest} className="mt-6" />
          )
        ) : null
      }
      contentContainerStyle={{ paddingBottom: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.forest} />}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    />
  );
}
