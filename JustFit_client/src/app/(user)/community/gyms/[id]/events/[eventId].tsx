import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { AuthImage } from "@/components/community/AuthImage";
import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { FormAlert } from "@/components/FormAlert";
import { usePullToRefresh } from "@/components/PullToRefresh";
import type { Member } from "@/lib/community";
import { formatTime, isEventPast } from "@/lib/gymRules";
import { gyms, type Gym, type GymEvent } from "@/lib/gyms";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

type EventDetail = GymEvent & { attendees: Member[]; canCancel: boolean };

// One event: date, time, place, spots left, what to expect, who's going, and RSVP. The host or a
// gym admin can cancel it (behind a confirmation). Events have no photo of their own, so the
// gym's cover is shown.
export default function EventScreen() {
  const { id, eventId } = useLocalSearchParams<{ id: string; eventId: string }>();
  const getToken = useSessionToken();
  const [gym, setGym] = useState<Gym | null>(null);
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const token = await getToken();
    const [gymResult, eventResult] = await Promise.all([gyms.get(token, id), gyms.event(token, id, eventId)]);
    if (gymResult.ok) setGym(gymResult.data.gym);
    if (eventResult.ok) {
      setEvent(eventResult.data.event);
      setError(null);
    } else setError(eventResult.error);
  }, [id, eventId, getToken]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(load, 0);
      return () => clearTimeout(timer);
    }, [load]),
  );

  // A pull reads the gym and the event (attendees, spots left) again
  const { refreshControl } = usePullToRefresh(load);

  const rsvp = async () => {
    if (!event || busy) return;
    setBusy(true);
    const result = await gyms.setRsvp(await getToken(), id, event.id, !event.going);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    await load();
  };

  const cancelEvent = async () => {
    if (!event) return;
    setBusy(true);
    const result = await gyms.deleteEvent(await getToken(), id, event.id);
    setBusy(false);
    setConfirming(false);
    if (!result.ok) return setError(result.error);
    router.back();
  };

  const [y, m, d] = (event?.date ?? "2000-01-01").split("-").map(Number);
  const longDate = new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const past = event ? isEventPast(event, new Date()) : false;
  const spots = event?.maxAttendees ? Math.max(0, event.maxAttendees - event.attendeeCount) : null;
  const canRsvp = gym?.membership?.status === "active" && !past;

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={() => router.back()} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <View className="flex-1 items-center">
            <Text className="screen-bar__title">Event</Text>
            {gym && <Text className="gym-card__meta" numberOfLines={1}>{gym.name}</Text>}
          </View>
          {event?.canCancel && !past ? (
            <Pressable onPress={() => setConfirming(true)} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Cancel event">
              <SymbolView name={{ ios: "trash", android: "delete", web: "delete" }} size={19} tintColor={colors.ink} />
            </Pressable>
          ) : (
            <View className="screen-bar__spacer" />
          )}
        </View>

        {!event ? (
          <View className="px-5 pt-6">
            {error ? <EmptyState icon={{ ios: "calendar", android: "event", web: "event" }} title="Can't open this event" text={error} actionLabel="Back" onAction={() => router.back()} /> : <ActivityIndicator color={colors.forest} />}
          </View>
        ) : (
          <>
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }} refreshControl={refreshControl}>
              {gym?.coverUrl ? <AuthImage path={gym.coverUrl} style={{ width: "100%", height: 190 }} accessibilityLabel={`${gym.name} cover photo`} /> : null}
              <View className="gap-3 px-5 pt-4">
                <View className={past ? "gym-badge self-start" : "gym-badge gym-badge--member self-start"}>
                  <Text className="gym-badge__label">{past ? "Past" : "Upcoming"}</Text>
                </View>
                <Text className="invite-card__name" style={{ textAlign: "left", marginTop: 0 }}>{event.title}</Text>
                {event.host && (
                  <View className="flex-row items-center gap-2">
                    <Avatar member={event.host} size={26} />
                    <Text className="gym-card__meta">Hosted by <Text className="post__author" style={{ fontSize: 14 }}>{event.host.name}</Text></Text>
                  </View>
                )}

                <View>
                  {(
                    [
                      { icon: { ios: "calendar", android: "event", web: "event" }, label: longDate },
                      { icon: { ios: "clock", android: "schedule", web: "schedule" }, label: `${formatTime(event.startTime)} – ${formatTime(event.endTime)}` },
                      { icon: { ios: "mappin.and.ellipse", android: "place", web: "place" }, label: event.location },
                    ] as const
                  ).map((row, index) => (
                    <View key={row.label} className={["about-row", index === 0 ? "friend-row--first" : ""].join(" ")}>
                      <View className="compose__option-icon">
                        <SymbolView name={row.icon} size={18} tintColor={colors.ink} />
                      </View>
                      <Text className="join-card__title flex-1">{row.label}</Text>
                    </View>
                  ))}
                  <View className="about-row friend-row--last">
                    <View className="compose__option-icon">
                      <SymbolView name={{ ios: "person.2", android: "group", web: "group" }} size={18} tintColor={colors.ink} />
                    </View>
                    <View className="flex-1 gap-2">
                      <Text className="join-card__title">{event.attendeeCount} going{spots !== null ? ` · ${spots === 0 ? "full" : `${spots} ${spots === 1 ? "spot" : "spots"} left`}` : ""}</Text>
                      {event.maxAttendees ? (
                        <View className="compose__progress">
                          <View className="compose__progress-fill" style={{ width: `${Math.min(100, Math.round((event.attendeeCount / event.maxAttendees) * 100))}%` }} />
                        </View>
                      ) : null}
                    </View>
                  </View>
                </View>

                <Text className="gym-about__title mt-2">About this event</Text>
                <Text className="post__body">{event.description}</Text>

                <Text className="gym-about__title mt-2">Attendees ({event.attendees.length})</Text>
                {event.attendees.length === 0 ? (
                  <Text className="home__note">Nobody has said they&apos;re going yet.</Text>
                ) : (
                  <View>
                    {event.attendees.map((person, index) => (
                      <Pressable key={person.id} onPress={() => router.push({ pathname: "/community/profile/[userId]", params: { userId: person.id } })} className={["friend-row", index === 0 ? "friend-row--first" : "", index === event.attendees.length - 1 ? "friend-row--last" : ""].join(" ")} accessibilityRole="button" accessibilityLabel={`Open ${person.name}'s profile`}>
                        <Avatar member={person} size={40} />
                        <Text className="friend-row__name flex-1" numberOfLines={1}>{person.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
                {error && <FormAlert message={error} />}
              </View>
            </ScrollView>
            {canRsvp && (
              <View className="compose__footer">
                <Pressable
                  onPress={rsvp}
                  disabled={busy || (event.full && !event.going)}
                  className={event.going ? "btn-outline flex-1" : "btn-forest flex-1"}
                  style={{ opacity: busy || (event.full && !event.going) ? 0.6 : 1 }}
                  accessibilityRole="button"
                  accessibilityLabel={event.going ? "Cancel my RSVP" : event.full ? "This event is full" : "RSVP, I'm going"}
                >
                  {busy ? <ActivityIndicator color={event.going ? colors.ink : colors.white} /> : <Text className={event.going ? "btn-outline__label" : "btn-forest__label"}>{event.going ? "Going ✓ · Cancel RSVP" : event.full ? "Full" : "RSVP — I'm going"}</Text>}
                </Pressable>
              </View>
            )}
          </>
        )}
      </SafeAreaView>
      <ConfirmSheet visible={confirming} title={event ? `Cancel ${event.title}?` : ""} text="Everyone who said they're going will see it's gone." confirmLabel="Cancel event" busy={busy} onConfirm={cancelEvent} onCancel={() => setConfirming(false)} />
    </View>
  );
}
