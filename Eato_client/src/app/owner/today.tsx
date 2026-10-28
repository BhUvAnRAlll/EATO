import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { SymbolView } from "@/components/SymbolView";

import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { durationLabel, owner, timeLabel, type Visit } from "@/lib/owner";
import { useSessionToken } from "@/lib/session";
import { useOwnerStore } from "@/store/owner";
import { colors } from "@/theme";

type Filter = "all" | "in" | "out";
const filters: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "in", label: "Checked in" },
  { key: "out", label: "Checked out" },
];

// Today's list: every visit today (and anyone still in), by name; tap one for its detail
export default function OwnerToday() {
  const getToken = useSessionToken();
  const gymId = useOwnerStore((state) => state.gymId);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Visit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!gymId) return;
    const result = await owner.visits(await getToken(), gymId, filter, search);
    if (result.ok) {
      setRows(result.data.visits);
      setError(null);
    } else setError(result.error);
  }, [gymId, filter, search, getToken]);

  // As the search is typed (debounced) and when the filter changes
  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }} edges={["top", "left", "right"]}>
      <View className="screen-bar">
        <Pressable onPress={() => router.back()} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
          <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
        </Pressable>
        <Text className="screen-bar__title">Today&apos;s list</Text>
        <View className="screen-bar__spacer" />
      </View>
      <FlatList
        data={rows ?? []}
        keyExtractor={(visit) => visit.id}
        ListHeaderComponent={
          <View className="gap-3 px-5 pb-3 pt-4">
            <View className="search search--pill">
              <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
              <TextInput className="search__input" value={search} onChangeText={setSearch} placeholder="Search by name" placeholderTextColor={colors.faint} autoCorrect={false} accessibilityLabel="Search visits" />
            </View>
            <View className="flex-row flex-wrap gap-2" accessibilityRole="tablist">
              {filters.map((item) => {
                const on = filter === item.key;
                return (
                  <Pressable key={item.key} onPress={() => setFilter(item.key)} className={on ? "friend-chip friend-chip--selected" : "friend-chip"} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={item.label}>
                    <Text className={on ? "friend-chip__label friend-chip__label--selected" : "friend-chip__label"}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        }
        ListEmptyComponent={
          <View className="px-5">
            {rows === null && !error ? (
              <ActivityIndicator color={colors.forest} />
            ) : error ? (
              <EmptyState icon={{ ios: "exclamationmark.triangle", android: "error_outline", web: "error_outline" }} title="Couldn't load" text={error} actionLabel="Retry" onAction={load} />
            ) : (
              <EmptyState icon={{ ios: "calendar", android: "event", web: "event" }} title="No visits" text={search ? "Nobody by that name today." : "Visits from today show here."} />
            )}
          </View>
        }
        renderItem={({ item, index }) => {
          const open = item.checkedOutAt === null;
          const when = open ? `In since ${timeLabel(item.checkedInAt)} · ${durationLabel(item.minutes)}` : `${timeLabel(item.checkedInAt)}–${timeLabel(item.checkedOutAt!)} · ${durationLabel(item.minutes)}`;
          const count = rows?.length ?? 0;
          return (
            <Pressable
              onPress={() => router.push({ pathname: "/owner/visit/[id]", params: { id: item.id } })}
              className={`friend-row mx-5 ${index === 0 ? "friend-row--first" : ""} ${index === count - 1 ? "friend-row--last" : ""}`}
              accessibilityRole="button"
              accessibilityLabel={`${item.member.name}, ${when}`}
            >
              <Avatar member={item.member} size={40} />
              <View className="min-w-0 flex-1">
                <Text className="friend-row__name" numberOfLines={1}>{item.member.name}</Text>
                <Text className="friend-row__note" numberOfLines={1}>{when}</Text>
              </View>
              <View className={open ? "owner-badge owner-badge--accent" : "owner-badge"}>
                <Text className="owner-badge__label">{open ? "Checked in" : "Checked out"}</Text>
              </View>
            </Pressable>
          );
        }}
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  );
}
