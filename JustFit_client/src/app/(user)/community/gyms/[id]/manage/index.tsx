import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { GymLogo } from "@/components/community/GymCard";
import { ManageShell } from "@/components/gyms/ManageShell";
import { plans, splitEvents, visibilityLabels } from "@/lib/gymRules";
import { gyms, type Gym } from "@/lib/gyms";
import { useSessionToken } from "@/lib/session";
import type { Icon } from "@/types/profile";
import { colors } from "@/theme";

type Counts = { active: number; pending: number; invitations: number; announcements: number; upcoming: number };

// Manage Gym (owner and admins): the gym at a glance, Invite and Announce, then Gym (profile,
// plan, community settings), People (members with requests, invitations) and Content
// (announcements, events). Each row opens its own page.
export default function ManageGym() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const getToken = useSessionToken();
  const [counts, setCounts] = useState<Counts | null>(null);

  // The numbers on the rows (each list is the caller's to see; the server checks it)
  const loadCounts = useCallback(async () => {
    const token = await getToken();
    const [active, pending, invitations, announcements, events] = await Promise.all([
      gyms.members(token, id, "active"),
      gyms.members(token, id, "pending"),
      gyms.invitations(token, id),
      gyms.announcements(token, id),
      gyms.events(token, id),
    ]);
    setCounts({
      active: active.ok ? active.data.members.length : 0,
      pending: pending.ok ? pending.data.members.length : 0,
      invitations: invitations.ok ? invitations.data.invitations.filter((i) => i.status === "pending").length : 0,
      announcements: announcements.ok ? announcements.data.announcements.length : 0,
      upcoming: events.ok ? splitEvents(events.data.events, new Date()).upcoming.length : 0,
    });
  }, [id, getToken]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(loadCounts, 0);
      return () => clearTimeout(timer);
    }, [loadCounts]),
  );

  const go = (path: "profile" | "plan" | "settings" | "members" | "announcements", params: Record<string, string> = {}) =>
    router.push({ pathname: `/community/gyms/[id]/manage/${path}`, params: { id, ...params } });

  return (
    <ManageShell title="Manage Gym">
      {(gym: Gym) => {
        const plan = plans.find((p) => p.id === gym.plan);
        const n = counts;
        return (
          <>
            <View className="join-card flex-row items-center gap-3">
              <GymLogo gym={gym} size={60} />
              <View className="min-w-0 flex-1">
                <Text className="gym-card__name" numberOfLines={1}>{gym.name}</Text>
                <Text className="gym-card__meta" numberOfLines={1}>{[`${gym.memberCount} ${gym.memberCount === 1 ? "member" : "members"}`, gym.location].filter(Boolean).join(" · ")}</Text>
                <View className="mt-1.5 flex-row gap-2">
                  <View className="gym-badge gym-badge--staff" style={{ height: 22 }}><Text className="gym-badge__label gym-badge__label--staff" style={{ fontSize: 12 }}>{plan?.name ?? "Starter"} plan</Text></View>
                  <View className="gym-badge gym-badge--member" style={{ height: 22 }}><Text className="gym-badge__label" style={{ fontSize: 12 }}>{visibilityLabels[gym.visibility].label}</Text></View>
                </View>
              </View>
            </View>

            <View className="flex-row gap-3">
              <Pressable onPress={() => router.push({ pathname: "/community/gyms/[id]/invite", params: { id } })} className="profile__button profile__button--filled flex-1" accessibilityRole="button" accessibilityLabel="Invite members">
                <SymbolView name={{ ios: "person.badge.plus", android: "person_add", web: "person_add" }} size={16} tintColor={colors.white} />
                <Text className="profile__button-label profile__button-label--filled">Invite members</Text>
              </Pressable>
              <Pressable onPress={() => go("announcements", { compose: "1" })} className="profile__button flex-1" accessibilityRole="button" accessibilityLabel="Announce">
                <SymbolView name={{ ios: "megaphone", android: "campaign", web: "campaign" }} size={16} tintColor={colors.ink} />
                <Text className="profile__button-label">Announce</Text>
              </Pressable>
            </View>

            <Group title="Gym">
              <Row icon={{ ios: "building.2", android: "apartment", web: "apartment" }} title="Gym Profile" hint="Name, images, location, hours, contact" onPress={() => go("profile")} first />
              <Row icon={{ ios: "creditcard", android: "credit_card", web: "credit_card" }} title="Subscription" hint={`${plan?.name ?? "Starter"} · ${plan?.price ?? "Free"} (display only)`} onPress={() => go("plan")} />
              <Row icon={{ ios: "slider.horizontal.3", android: "tune", web: "tune" }} title="Community Settings" hint="Posting, comments, approvals, visibility" onPress={() => go("settings")} last />
            </Group>
            <Group title="People">
              <Row icon={{ ios: "person.2", android: "group", web: "group" }} title="Members" first hint={n ? `${n.active} active` : "…"} badge={n && n.pending > 0 ? `${n.pending} pending` : null} onPress={() => go("members", n && n.pending > 0 ? { list: "pending" } : {})} />
              <Row icon={{ ios: "envelope", android: "mail", web: "mail" }} title="Invitations" hint={n ? `${n.invitations} pending` : "…"} onPress={() => router.push({ pathname: "/community/gyms/[id]/invite", params: { id } })} last />
            </Group>
            <Group title="Content">
              <Row icon={{ ios: "megaphone", android: "campaign", web: "campaign" }} title="Announcements" hint={n ? `${n.announcements} published` : "…"} onPress={() => go("announcements")} first />
              <Row icon={{ ios: "calendar", android: "event", web: "event" }} title="Events" hint={n ? `${n.upcoming} upcoming` : "…"} onPress={() => router.push({ pathname: "/community/gyms/[id]", params: { id, tab: "events" } })} last />
            </Group>
          </>
        );
      }}
    </ManageShell>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="gym-group__title">{title}</Text>
      <View>{children}</View>
    </View>
  );
}

function Row({ icon, title, hint, badge = null, onPress, first = false, last = false }: { icon: Icon; title: string; hint: string; badge?: string | null; onPress: () => void; first?: boolean; last?: boolean }) {
  return (
    <Pressable onPress={onPress} className={["about-row", first ? "friend-row--first" : "", last ? "friend-row--last" : ""].join(" ")} accessibilityRole="button" accessibilityLabel={badge ? `${title}, ${badge}` : title}>
      <View className="compose__option-icon">
        <SymbolView name={icon} size={18} tintColor={colors.ink} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="join-card__title">{title}</Text>
        <Text className="join-card__hint" numberOfLines={1}>{hint}</Text>
      </View>
      {badge && <View className="gym-pending"><Text className="gym-pending__label">{badge}</Text></View>}
      <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={15} tintColor={colors.inkSoft} />
    </Pressable>
  );
}
