import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect, type Href } from "expo-router";
import { SymbolView } from "expo-symbols";

import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { OwnerHeader } from "@/components/owner/OwnerHeader";
import { isOffline } from "@/lib/community";
import { monthLabel, type OwnerSummary } from "@/lib/owner";
import { useSessionToken } from "@/lib/session";
import { useOwnerStore } from "@/store/owner";
import type { Icon } from "@/types/profile";
import { colors } from "@/theme";

const planLabel: Record<OwnerSummary["stats"]["plan"], string> = { starter: "Starter", pro: "Pro", elite: "Elite" };

type AttentionRow = { key: string; icon: Icon; tone: "warning" | "danger"; title: string; note: string; to: Href };

// The "Needs your attention" rows that have something waiting, each opening the screen that fixes it
function attentionRows(s: OwnerSummary, memberApp: boolean): AttentionRow[] {
  const a = s.attention;
  const rows: AttentionRow[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (a.joinRequests > 0) rows.push({ key: "join", icon: { ios: "person.badge.plus", android: "person_add", web: "person_add" }, tone: "warning", title: plural(a.joinRequests, "join request", "join requests"), note: "Approve or decline people who asked to join", to: { pathname: "/owner/members", params: { list: "pending" } } });
  if (a.postsToReview > 0) rows.push({ key: "review", icon: { ios: "checkmark.shield", android: "verified_user", web: "verified_user" }, tone: "warning", title: plural(a.postsToReview, "post awaiting review", "posts awaiting review"), note: "Members can't see these until you approve them", to: "/owner/review" });
  if (a.reportedPosts > 0) rows.push({ key: "reported", icon: { ios: "flag", android: "flag", web: "flag" }, tone: "danger", title: plural(a.reportedPosts, "reported post", "reported posts"), note: "Members flagged posts in your gym", to: "/owner/review" });
  const ending = a.membershipsExpired + a.membershipsEndingThisWeek;
  if (ending > 0) rows.push({ key: "renewals", icon: { ios: "calendar.badge.clock", android: "event_busy", web: "event_busy" }, tone: "danger", title: plural(ending, "membership ending", "memberships ending"), note: `${a.membershipsExpired} expired · ${a.membershipsEndingThisWeek} end this week. Renew them`, to: "/owner/renewals" });
  if (a.invitationsPending > 0 && memberApp) rows.push({ key: "invites", icon: { ios: "envelope", android: "mail", web: "mail" }, tone: "warning", title: plural(a.invitationsPending, "invitation not accepted yet", "invitations not accepted yet"), note: "Share them again or revoke them", to: { pathname: "/community/gyms/[id]/invite", params: { id: s.gym.id } } });
  return rows;
}

// Owner Home: today at a glance. Stat tiles, quick actions, what needs attention, new members
// by month, the coaching team and the next event.
export default function OwnerHome() {
  const getToken = useSessionToken();
  const summary = useOwnerStore((state) => state.summary);
  const error = useOwnerStore((state) => state.error);
  const loadSummary = useOwnerStore((state) => state.loadSummary);
  const [refreshing, setRefreshing] = useState(false);
  // Three tiles a row, or two on narrow phones (so "Upcoming events" never breaks mid-word)
  const tileWidth = useWindowDimensions().width < 360 ? "45%" : "30%";

  useFocusEffect(
    useCallback(() => {
      (async () => loadSummary(await getToken()))();
    }, [getToken, loadSummary]),
  );

  const refresh = async () => {
    setRefreshing(true);
    await loadSummary(await getToken());
    setRefreshing(false);
  };

  // Screens under the member app (manage, invite, events) open for the gym's own staff; an
  // EATO admin helping out sees the dashboard and renewals
  const memberApp = summary?.gym.as !== "platform";
  const gymId = summary?.gym.id ?? "";

  if (!summary) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }} edges={["top", "left", "right"]}>
        <OwnerHeader title="Home" subtitle="Today at a glance: what needs you and how the gym is doing." />
        <View className="flex-1 justify-center px-5">
          {error ? (
            <EmptyState
              icon={isOffline(error) ? { ios: "wifi.slash", android: "wifi_off", web: "wifi_off" } : { ios: "exclamationmark.triangle", android: "error_outline", web: "error_outline" }}
              title={isOffline(error) ? "You're offline" : "Couldn't load"}
              text={error}
              actionLabel="Retry"
              onAction={refresh}
            />
          ) : (
            <ActivityIndicator color={colors.forest} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  const s = summary;
  const tiles: { label: string; value: string; icon: Icon; highlight?: boolean; to: Href }[] = [
    { label: "Members", value: String(s.stats.members), icon: { ios: "person.2", android: "group", web: "group" }, to: "/owner/members" },
    { label: "Join requests", value: String(s.stats.joinRequests), icon: { ios: "person.badge.plus", android: "person_add", web: "person_add" }, highlight: s.stats.joinRequests > 0, to: { pathname: "/owner/members", params: { list: "pending" } } },
    { label: "Upcoming events", value: String(s.stats.upcomingEvents), icon: { ios: "calendar", android: "event", web: "event" }, to: memberApp ? { pathname: "/community/gyms/[id]", params: { id: gymId, tab: "events" } } : "/owner" },
    { label: "Trainers", value: String(s.stats.trainers), icon: { ios: "dumbbell", android: "fitness_center", web: "fitness_center" }, to: { pathname: "/owner/members", params: { list: "staff" } } },
    { label: "Posts this week", value: String(s.stats.postsThisWeek), icon: { ios: "megaphone", android: "campaign", web: "campaign" }, to: memberApp ? { pathname: "/community/gyms/[id]", params: { id: gymId } } : "/owner" },
    { label: "Plan", value: planLabel[s.stats.plan], icon: { ios: "creditcard", android: "credit_card", web: "credit_card" }, to: "/owner/gym" },
  ];
  const attention = attentionRows(s, memberApp);
  const maxJoined = Math.max(1, ...s.newMembers.map((m) => m.count));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.forest} />}>
        <OwnerHeader title="Home" subtitle="Today at a glance: what needs you and how the gym is doing." />

        <View className="mx-5 mt-4 flex-row flex-wrap gap-3">
          {tiles.map((tile) => (
            <Pressable
              key={tile.label}
              onPress={() => router.navigate(tile.to)}
              className={tile.highlight ? "owner-stat owner-stat--highlight" : "owner-stat"}
              style={{ minWidth: tileWidth }}
              accessibilityRole="button"
              accessibilityLabel={`${tile.label}: ${tile.value}`}
            >
              <SymbolView name={tile.icon} size={18} tintColor={tile.highlight ? colors.warning : colors.ink} />
              <Text className="owner-stat__label" numberOfLines={2}>{tile.label}</Text>
              {/* One line: a long plan name shrinks to fit a narrow tile instead of breaking mid-word */}
              <Text className="owner-stat__value" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{tile.value}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={() => router.navigate("/owner/checkin")} className="owner-card mx-5 mt-4 flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel={`${s.inGymNow} in the gym now. Open Check-in`}>
          <View className="owner-icon owner-icon--neutral">
            <SymbolView name={{ ios: "qrcode.viewfinder", android: "qr_code_scanner", web: "qr_code_scanner" }} size={18} tintColor={colors.ink} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="friend-row__name">{s.inGymNow} in the gym now</Text>
            <Text className="friend-row__note">Scan member QR codes to check people in</Text>
          </View>
          <Text className="gym-section__link">Check-in</Text>
        </Pressable>

        {memberApp && (
          <View className="mx-5 mt-4 flex-row flex-wrap gap-2">
            <Pressable onPress={() => router.push({ pathname: "/community/gyms/[id]/invite", params: { id: gymId } })} className="owner-quick owner-quick--primary" accessibilityRole="button" accessibilityLabel="Invite">
              <SymbolView name={{ ios: "person.badge.plus", android: "person_add", web: "person_add" }} size={16} tintColor={colors.white} />
              <Text className="owner-quick__label owner-quick__label--primary">Invite</Text>
            </Pressable>
            <Pressable onPress={() => router.push({ pathname: "/community/gyms/[id]/manage/announcements", params: { id: gymId } })} className="owner-quick" accessibilityRole="button" accessibilityLabel="Announce">
              <SymbolView name={{ ios: "megaphone", android: "campaign", web: "campaign" }} size={16} tintColor={colors.ink} />
              <Text className="owner-quick__label">Announce</Text>
            </Pressable>
            <Pressable onPress={() => router.push({ pathname: "/community/gyms/[id]/event-new", params: { id: gymId } })} className="owner-quick" accessibilityRole="button" accessibilityLabel="Event">
              <SymbolView name={{ ios: "calendar.badge.plus", android: "event", web: "event" }} size={16} tintColor={colors.ink} />
              <Text className="owner-quick__label">Event</Text>
            </Pressable>
          </View>
        )}

        <Text className="gym-section__title mx-5 mt-6">Needs your attention</Text>
        <View className="mx-5 mt-3">
          {attention.length === 0 ? (
            <View className="owner-card items-center">
              <SymbolView name={{ ios: "checkmark.circle", android: "check_circle", web: "check_circle" }} size={24} tintColor={colors.leaf} />
              <Text className="friend-row__name">All caught up</Text>
              <Text className="friend-row__note text-center">Join requests, posts to review, reports, renewals and invitations show here.</Text>
            </View>
          ) : (
            attention.map((row, index) => (
              <Pressable
                key={row.key}
                onPress={() => router.navigate(row.to)}
                className={`friend-row ${index === 0 ? "friend-row--first" : ""} ${index === attention.length - 1 ? "friend-row--last" : ""}`}
                accessibilityRole="button"
                accessibilityLabel={`${row.title}. ${row.note}`}
              >
                <View className={row.tone === "danger" ? "owner-icon owner-icon--danger" : "owner-icon"}>
                  <SymbolView name={row.icon} size={18} tintColor={row.tone === "danger" ? colors.danger : colors.warning} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="friend-row__name">{row.title}</Text>
                  <Text className="friend-row__note">{row.note}</Text>
                </View>
                <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
              </Pressable>
            ))
          )}
        </View>

        <View className="owner-card mx-5 mt-6" accessibilityLabel={`New members in the last 6 months: ${s.newMembers.map((m) => `${monthLabel(m.month)} ${m.count}`).join(", ")}`}>
          <View className="flex-row items-center justify-between">
            <Text className="home__eyebrow">New members</Text>
            <Text className="owner-stat__label">Last 6 months</Text>
          </View>
          {s.newMembers.map((m) => (
            <View key={m.month} className="flex-row items-center gap-3">
              <Text className="owner-chart__label">{monthLabel(m.month)}</Text>
              <View className="owner-chart__track">
                <View className="owner-chart__fill" style={{ width: `${(m.count / maxJoined) * 100}%` }} />
              </View>
              <Text className="owner-chart__count">{m.count}</Text>
            </View>
          ))}
        </View>

        <View className="mx-5 mt-6 flex-row items-center justify-between">
          <Text className="gym-section__title">Coaching team</Text>
          <Pressable onPress={() => router.navigate({ pathname: "/owner/members", params: { list: "staff" } })} hitSlop={8} accessibilityRole="button" accessibilityLabel="Manage trainers">
            <Text className="gym-section__link">Manage</Text>
          </Pressable>
        </View>
        <View className="mx-5 mt-3">
          {s.coachingTeam.length === 0 ? (
            <View className="owner-card">
              <Text className="friend-row__note">No trainers yet. Give a member the trainer role from Members.</Text>
            </View>
          ) : (
            s.coachingTeam.map((t, index) => (
              <View key={t.member.id} className={`friend-row ${index === 0 ? "friend-row--first" : ""} ${index === s.coachingTeam.length - 1 ? "friend-row--last" : ""}`}>
                <Avatar member={t.member} size={40} />
                <View className="min-w-0 flex-1">
                  <Text className="friend-row__name" numberOfLines={1}>{t.member.name}</Text>
                  <Text className="friend-row__note" numberOfLines={1}>
                    {[t.title, t.clients > 0 ? `${t.clients} coaching ${t.clients === 1 ? "client" : "clients"}` : null].filter(Boolean).join(" · ") || "Trainer"}
                  </Text>
                </View>
                <View className="owner-badge owner-badge--accent">
                  <Text className="owner-badge__label">Trainer</Text>
                </View>
              </View>
            ))
          )}
        </View>

        <View className="mx-5 mt-6 flex-row items-center justify-between">
          <Text className="gym-section__title">Next up</Text>
          {memberApp && (
            <Pressable onPress={() => router.push({ pathname: "/community/gyms/[id]", params: { id: gymId, tab: "events" } })} hitSlop={8} accessibilityRole="button" accessibilityLabel="All events">
              <Text className="gym-section__link">All events</Text>
            </Pressable>
          )}
        </View>
        <View className="mx-5 mt-3">
          {s.nextEvent ? (
            <Pressable
              onPress={() => memberApp && router.push({ pathname: "/community/gyms/[id]/events/[eventId]", params: { id: gymId, eventId: s.nextEvent!.id } })}
              disabled={!memberApp}
              className="owner-card"
              accessibilityRole="button"
              accessibilityLabel={`Next event: ${s.nextEvent.title}`}
            >
              <Text className="friend-row__name">{s.nextEvent.title}</Text>
              <Text className="friend-row__note">
                {s.nextEvent.date} · {s.nextEvent.startTime}–{s.nextEvent.endTime} · {s.nextEvent.location}
              </Text>
              <Text className="friend-row__note">
                {s.nextEvent.attendeeCount} going{s.nextEvent.maxAttendees ? ` of ${s.nextEvent.maxAttendees}` : ""}
              </Text>
            </Pressable>
          ) : (
            <View className="owner-card">
              <Text className="friend-row__note">No upcoming events.</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
