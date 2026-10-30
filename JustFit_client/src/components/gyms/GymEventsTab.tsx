import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";
import { router } from "expo-router";

import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { eventDateParts, formatTime, splitEvents } from "@/lib/gymRules";
import type { Gym, GymEvent } from "@/lib/gyms";
import { colors } from "@/theme";

type GymEventsTabProps = {
  gym: Gym;
  events: GymEvent[];
  busyId: string | null;
  onRsvp: (event: GymEvent) => void;
};

// A gym's Events tab: Upcoming / Past, Create (when the gym's settings allow), and a card per
// event with its date block, time, place, who's going and RSVP. A card opens the event.
export function GymEventsTab({ gym, events, busyId, onRsvp }: GymEventsTabProps) {
  const [view, setView] = useState<"upcoming" | "past">("upcoming");
  const { upcoming, past } = splitEvents(events, new Date());
  const shown = view === "upcoming" ? upcoming : past;
  const canRsvp = gym.membership?.status === "active";

  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-3">
        <View className="segment flex-1" accessibilityRole="tablist">
          {(["upcoming", "past"] as const).map((key) => (
            <Pressable key={key} onPress={() => setView(key)} className={view === key ? "segment__item segment__item--active" : "segment__item"} accessibilityRole="tab" accessibilityState={{ selected: view === key }}>
              <Text className={view === key ? "segment__label segment__label--active" : "segment__label"}>{key === "upcoming" ? `Upcoming (${upcoming.length})` : `Past (${past.length})`}</Text>
            </Pressable>
          ))}
        </View>
        {gym.can.createEvents && (
          <Pressable onPress={() => router.push({ pathname: "/community/gyms/[id]/event-new", params: { id: gym.id } })} className="gym-action gym-action--filled" accessibilityRole="button" accessibilityLabel="Create event">
            <SymbolView name={{ ios: "calendar.badge.plus", android: "event", web: "event" }} size={16} tintColor={colors.white} />
            <Text className="gym-action__label gym-action__label--filled">Create</Text>
          </Pressable>
        )}
      </View>
      {shown.length === 0 ? (
        <EmptyState icon={{ ios: "calendar", android: "event", web: "event" }} title={view === "upcoming" ? "No upcoming events" : "No past events"} text={view === "upcoming" ? "Classes, clinics and meet-ups will show here." : "Events from the last few weeks show here."} />
      ) : (
        shown.map((event) => (
          <EventCard key={event.id} gym={gym} event={event} past={view === "past"} busy={busyId === event.id} canRsvp={canRsvp} onRsvp={() => onRsvp(event)} />
        ))
      )}
    </View>
  );
}

function EventCard({ gym, event, past, busy, canRsvp, onRsvp }: { gym: Gym; event: GymEvent; past: boolean; busy: boolean; canRsvp: boolean; onRsvp: () => void }) {
  const date = eventDateParts(event.date);
  const going = event.maxAttendees ? `${event.attendeeCount} / ${event.maxAttendees} going` : `${event.attendeeCount} going`;
  const open = () => router.push({ pathname: "/community/gyms/[id]/events/[eventId]", params: { id: gym.id, eventId: event.id } });
  return (
    <View className="event-card" style={{ opacity: past ? 0.75 : 1 }}>
      <Pressable onPress={open} className="flex-row gap-3 p-4" accessibilityRole="button" accessibilityLabel={`${event.title}, ${date.weekday} ${date.day} ${date.month}`}>
        <View className="event-card__date">
          <Text className="event-card__month">{date.month}</Text>
          <Text className="event-card__day">{date.day}</Text>
        </View>
        <View className="min-w-0 flex-1">
          <Text className="event-card__title" numberOfLines={2}>{event.title}</Text>
          <View className="mt-1 flex-row items-center gap-1.5">
            <SymbolView name={{ ios: "clock", android: "schedule", web: "schedule" }} size={13} tintColor={colors.muted} />
            <Text className="gym-card__meta">{date.weekday} · {formatTime(event.startTime)} – {formatTime(event.endTime)}</Text>
          </View>
          <View className="mt-0.5 flex-row items-center gap-1.5">
            <SymbolView name={{ ios: "mappin.and.ellipse", android: "place", web: "place" }} size={13} tintColor={colors.muted} />
            <Text className="gym-card__meta flex-1" numberOfLines={1}>{event.location}</Text>
          </View>
        </View>
      </Pressable>
      <View className="event-card__footer">
        <View className="flex-row" style={{ marginRight: 8 }}>
          {(event.attendeesPreview ?? []).map((member, index) => (
            <View key={member.id} className="event-card__face" style={{ marginLeft: index === 0 ? 0 : -8 }}>
              <Avatar member={member} size={26} />
            </View>
          ))}
        </View>
        <Text className="gym-card__meta flex-1">{going}</Text>
        {!past && canRsvp && (
          <Pressable
            onPress={onRsvp}
            disabled={busy || (event.full && !event.going)}
            className={event.going ? "event-going" : "gym-join gym-join--filled"}
            style={{ opacity: busy || (event.full && !event.going) ? 0.5 : 1 }}
            accessibilityRole="button"
            accessibilityLabel={event.going ? `Cancel your RSVP for ${event.title}` : event.full ? `${event.title} is full` : `RSVP to ${event.title}`}
          >
            {busy ? <ActivityIndicator color={event.going ? colors.ink : colors.white} /> : <Text className={event.going ? "event-going__label" : "gym-join__label gym-join__label--filled"}>{event.going ? "Going ✓" : event.full ? "Full" : "RSVP"}</Text>}
          </Pressable>
        )}
      </View>
    </View>
  );
}
