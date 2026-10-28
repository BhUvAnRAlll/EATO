import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect } from "expo-router";

import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { FormAlert } from "@/components/FormAlert";
import { community, type CloseFriend } from "@/lib/community";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

// The member's Close Friends: who sees their close-friends stories. Lists their followers;
// Add / Remove changes the list at once. Only the member can see this list.
export default function CloseFriends() {
  const getToken = useSessionToken();
  const [entries, setEntries] = useState<CloseFriend[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await community.closeFriends(await getToken());
    if (result.ok) {
      setEntries(result.data.members);
      setError(null);
    } else {
      setError(result.error);
      setEntries((current) => current ?? []);
    }
  }, [getToken]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const toggle = async (entry: CloseFriend) => {
    if (busyId) return;
    setBusyId(entry.member.id);
    const result = await community.setCloseFriend(await getToken(), entry.member.id, !entry.isCloseFriend);
    setBusyId(null);
    if (!result.ok) return setError(result.error);
    setEntries((current) => (current ?? []).map((item) => (item.member.id === entry.member.id ? { ...item, isCloseFriend: result.data.isCloseFriend } : item)));
  };

  const count = entries?.filter((entry) => entry.isCloseFriend).length ?? 0;

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="h-12 flex-row items-center px-5">
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
          </Pressable>
          <Text className="type-subhead ml-3 flex-1 text-forest-ink">Close Friends</Text>
        </View>

        {entries === null ? (
          <ActivityIndicator color={colors.forest} className="mt-6" />
        ) : (
          <FlatList
            data={entries}
            keyExtractor={(entry) => entry.member.id}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
            ListHeaderComponent={
              <View className="gap-3 pb-4">
                <View className="setup__info">
                  <SymbolView name={{ ios: "lock", android: "lock", web: "lock" }} size={18} tintColor={colors.forest} />
                  <Text className="setup__card-text flex-1">{`Only you can see this list. Close Friends stories show to these ${count === 1 ? "person" : "people"} only.`}</Text>
                </View>
                {error && (
                  <Pressable onPress={() => setError(null)}>
                    <FormAlert message={error} />
                  </Pressable>
                )}
              </View>
            }
            ListEmptyComponent={
              <EmptyState icon={{ ios: "person.2", android: "group", web: "group" }} title="No followers yet" text="When members follow you, you can add them here." actionLabel={error ? "Retry" : undefined} onAction={error ? load : undefined} />
            }
            renderItem={({ item }) => (
              <View className="flex-row items-center gap-3 py-2.5">
                <Avatar member={item.member} size={44} />
                <Text className="post__author flex-1" numberOfLines={1}>
                  {item.member.name}
                </Text>
                <Pressable
                  onPress={() => toggle(item)}
                  disabled={busyId !== null}
                  className={item.isCloseFriend ? "group__join group__join--joined" : "group__join"}
                  style={{ opacity: busyId === item.member.id ? 0.5 : 1 }}
                  accessibilityRole="button"
                  accessibilityLabel={item.isCloseFriend ? `Remove ${item.member.name} from Close Friends` : `Add ${item.member.name} to Close Friends`}
                >
                  <Text className={item.isCloseFriend ? "group__join-label group__join-label--joined" : "group__join-label"}>{item.isCloseFriend ? "Remove" : "Add"}</Text>
                </Pressable>
              </View>
            )}
          />
        )}
      </SafeAreaView>
    </View>
  );
}
