import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { SymbolView } from "@/components/SymbolView";

import { EmptyState } from "@/components/community/CommunityStates";
import { GymEventsTab } from "@/components/gyms/GymEventsTab";
import { splitEvents } from "@/lib/gymRules";
import { gyms, type Gym, type GymEvent } from "@/lib/gyms";
import { useSessionToken } from "@/lib/session";
import { useOwnerStore } from "@/store/owner";
import { colors } from "@/theme";

// Events: the gym's upcoming and past events with RSVP totals, and Create event. The list is the
// gym page's Events tab (cards open each event; capacity is enforced when members RSVP).
export default function OwnerEvents() {
  const getToken = useSessionToken();
  const gymId = useOwnerStore((state) => state.gymId);
  const [gym, setGym] = useState<Gym | null>(null);
  const [events, setEvents] = useState<GymEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!gymId) return;
    const token = await getToken();
    const [g, e] = await Promise.all([gyms.get(token, gymId), gyms.events(token, gymId)]);
    if (g.ok) setGym(g.data.gym);
    if (e.ok) setEvents(e.data.events);
    setError(!g.ok ? g.error : !e.ok ? e.error : null);
  }, [gymId, getToken]);

  // Each time the screen shows (a new event may have just been created)
  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(load, 0);
      return () => clearTimeout(timer);
    }, [load]),
  );

  const rsvp = async (event: GymEvent) => {
    if (!gymId) return;
    setBusyId(event.id);
    const result = await gyms.setRsvp(await getToken(), gymId, event.id, !event.going);
    setBusyId(null);
    if (result.ok) setEvents((list) => list?.map((e) => (e.id === event.id ? result.data.event : e)) ?? list);
    else setError(result.error);
  };

  const { upcoming } = splitEvents(events ?? [], new Date());
  const rsvps = upcoming.reduce((sum, e) => sum + e.attendeeCount, 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }} edges={["top", "left", "right"]}>
      <View className="screen-bar">
        <Pressable onPress={() => router.back()} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
          <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
        </Pressable>
        <Text className="screen-bar__title">Events</Text>
        <View className="screen-bar__back" />
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.forest} />}
      >
        <Text className="owner__subtitle">Classes, workshops and meetups members can RSVP to.</Text>
        {!gym || !events ? (
          error ? (
            <EmptyState icon={{ ios: "exclamationmark.triangle", android: "error_outline", web: "error_outline" }} title="Couldn't load" text={error} actionLabel="Retry" onAction={load} />
          ) : (
            <ActivityIndicator color={colors.forest} />
          )
        ) : (
          <>
            <Text className="owner-stat__label" accessibilityLabel={`${upcoming.length} upcoming, ${rsvps} RSVPs in total`}>{upcoming.length} upcoming · {rsvps} RSVPs in total</Text>
            <GymEventsTab gym={gym} events={events} busyId={busyId} onRsvp={rsvp} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
