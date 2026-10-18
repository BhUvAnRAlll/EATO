import { useCallback, useState, type ReactElement } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { router, useFocusEffect } from "expo-router";

import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { GymCard, GymLogo, GymTile } from "@/components/community/GymCard";
import { FormAlert } from "@/components/FormAlert";
import { isOffline } from "@/lib/community";
import { gyms, type Gym, type MyInvitation } from "@/lib/gyms";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

const PREVIEW = 4; // gyms in the Explore preview (two rows of two)

// The Gyms tab: invitations sent to you, My Gyms (any status) with + Join Gym, and a short
// Explore preview whose View All opens the Explore screen (search and filters live there).
// `header` is the Community header, drawn above so the page scrolls as one.
export function GymsPanel({ header }: { header: ReactElement }) {
  const getToken = useSessionToken();
  const [lists, setLists] = useState<{ mine: Gym[]; explore: Gym[] } | null>(null);
  const [invitations, setInvitations] = useState<MyInvitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    const [result, invites] = await Promise.all([gyms.list(token), gyms.myInvitations(token)]);
    if (result.ok) {
      setLists(result.data);
      setError(null);
    } else setError(result.error);
    if (invites.ok) setInvitations(invites.data.invitations);
  }, [getToken]);

  // Loads when the tab is shown, and again on coming back from a gym (joined, left) or an
  // invitation (accepted), so the change shows
  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(load, 0);
      return () => clearTimeout(timer);
    }, [load]),
  );

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
  const preview = lists?.explore.slice(0, PREVIEW) ?? [];
  const rows = Array.from({ length: Math.ceil(preview.length / 2) }, (_, i) => preview.slice(i * 2, i * 2 + 2));

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 24 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.forest} />}
      showsVerticalScrollIndicator={false}
    >
      {header}

      {error && lists !== null && (
        <Pressable onPress={() => setError(null)} className="mx-5 mt-3">
          <FormAlert message={error} />
        </Pressable>
      )}

      {invitations.map((invite) => (
        <View key={invite.code} className="gym-invite mx-5 mt-5">
          <GymLogo gym={invite.gym} size={40} />
          <View className="min-w-0 flex-1">
            <Text className="gym-invite__title" numberOfLines={2}>{invite.gym.name} invited you{invite.role === "trainer" ? " as a trainer" : ""}</Text>
            {invite.invitedBy && (
              <View className="mt-0.5 flex-row items-center gap-1.5">
                <Avatar member={invite.invitedBy} size={18} />
                <Text className="gym-invite__from" numberOfLines={1}>from {invite.invitedBy.name}</Text>
              </View>
            )}
          </View>
          <Pressable onPress={() => router.push({ pathname: "/community/gyms/invite/[code]", params: { code: invite.code } })} className="gym-invite__review" accessibilityRole="button" accessibilityLabel={`Review the invitation from ${invite.gym.name}`}>
            <Text className="gym-invite__review-label">Review</Text>
          </Pressable>
        </View>
      ))}

      {lists === null ? (
        <View className="px-5 pt-6">
          {error ? (
            <EmptyState icon={isOffline(error) ? { ios: "wifi.slash", android: "wifi_off", web: "wifi_off" } : { ios: "exclamationmark.triangle", android: "error_outline", web: "error_outline" }} title={isOffline(error) ? "You're offline" : "Couldn't load gyms"} text={error} actionLabel="Retry" onAction={load} />
          ) : (
            <ActivityIndicator color={colors.forest} />
          )}
        </View>
      ) : (
        <>
          <View className="mx-5 mt-6 flex-row items-center justify-between">
            <Text className="gym-section__title">My Gyms</Text>
            <Pressable onPress={() => router.push("/community/gyms/join")} className="gym-section__join" accessibilityRole="button" accessibilityLabel="Join Gym">
              <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={15} tintColor={colors.ink} />
              <Text className="gym-section__join-label">Join Gym</Text>
            </Pressable>
          </View>
          {lists.mine.length === 0 ? (
            <View className="mx-5 mt-3">
              <EmptyState icon={{ ios: "dumbbell", android: "fitness_center", web: "fitness_center" }} title="No gyms yet" text="Join your gym with its code or QR, or find one below." />
            </View>
          ) : (
            <View className="mx-5 mt-3 gap-3">
              {lists.mine.map((gym) => (
                <GymCard key={gym.id} gym={gym} busy={busyId === gym.id} onOpen={() => open(gym)} onAction={(action) => act(gym, action)} />
              ))}
            </View>
          )}

          <View className="mx-5 mt-7 flex-row items-center justify-between">
            <Text className="gym-section__title">Explore Gyms</Text>
            <Pressable onPress={() => router.push("/community/gyms/explore")} hitSlop={8} accessibilityRole="button" accessibilityLabel="View all gyms">
              <Text className="gym-section__link">View All</Text>
            </Pressable>
          </View>
          {preview.length === 0 ? (
            <View className="mx-5 mt-3">
              <EmptyState icon={{ ios: "map", android: "map", web: "map" }} title="No other gyms yet" text="Gyms you can join will appear here." />
            </View>
          ) : (
            <View className="mx-5 mt-3 gap-3">
              {rows.map((row) => (
                <View key={row.map((g) => g.id).join("-")} className="flex-row gap-3">
                  {row.map((gym) => (
                    <GymTile key={gym.id} gym={gym} busy={busyId === gym.id} onOpen={() => open(gym)} onAction={(action) => act(gym, action)} />
                  ))}
                  {row.length === 1 && <View className="flex-1" />}
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}
