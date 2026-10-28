import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView } from "@/components/SymbolView";
import { router } from "expo-router";

import { AuthImage } from "@/components/community/AuthImage";
import { GymLogo } from "@/components/community/GymCard";
import { membershipButton, roleLabels } from "@/lib/gymRules";
import type { Gym } from "@/lib/gyms";
import { colors } from "@/theme";

export type GymTab = "feed" | "members" | "events" | "about";
const tabs: { key: GymTab; label: string }[] = [
  { key: "feed", label: "Feed" },
  { key: "members", label: "Members" },
  { key: "events", label: "Events" },
  { key: "about", label: "About" },
];

type GymHeaderProps = {
  gym: Gym;
  tab: GymTab;
  busy: boolean;
  onTab: (tab: GymTab) => void;
  // Join, request, or cancel a pending request (leaving is on About, behind a confirmation)
  onMembership: () => void;
};

const members = (count: number) => `${count.toLocaleString("en-IN")} ${count === 1 ? "member" : "members"}`;

// The top of a gym's page: cover with round back / invite / settings buttons, the logo over the
// cover's edge, name, tagline, area, members and where the viewer stands, the actions (Create
// Post, Invite, Ask the gym, or Join / Request to Join and Ask), then the underlined tabs.
export function GymHeader({ gym, tab, busy, onTab, onMembership }: GymHeaderProps) {
  const insets = useSafeAreaInsets();
  const active = gym.membership?.status === "active";
  const button = membershipButton(gym.membership, gym.joinMode);
  const go = (pathname: "/community/gyms/[id]/invite" | "/community/gyms/[id]/manage") => router.push({ pathname, params: { id: gym.id } });
  const ask = () => router.push({ pathname: "/community/gyms/[id]/ask", params: { id: gym.id } });

  return (
    <View>
      <View>
        {gym.coverUrl ? (
          <AuthImage path={gym.coverUrl} style={{ width: "100%", height: 196 + insets.top }} accessibilityLabel={`${gym.name} cover photo`} />
        ) : (
          <View className="gym-cover" style={{ height: 196 + insets.top }} />
        )}
        <View className="gym-hero__bar" style={{ top: insets.top + 8 }}>
          <Pressable onPress={() => router.back()} className="gym-hero__button" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={18} tintColor={colors.ink} />
          </Pressable>
          <View className="flex-row gap-2">
            {gym.can.invite && (
              <Pressable onPress={() => go("/community/gyms/[id]/invite")} className="gym-hero__button" accessibilityRole="button" accessibilityLabel="Invite members">
                <SymbolView name={{ ios: "person.badge.plus", android: "person_add", web: "person_add" }} size={18} tintColor={colors.ink} />
              </Pressable>
            )}
            {gym.can.manage && (
              <Pressable onPress={() => go("/community/gyms/[id]/manage")} className="gym-hero__button" accessibilityRole="button" accessibilityLabel="Manage gym">
                <SymbolView name={{ ios: "gearshape", android: "settings", web: "settings" }} size={18} tintColor={colors.ink} />
              </Pressable>
            )}
          </View>
        </View>
      </View>

      <View className="px-5">
        <View className="gym-hero__logo">
          <GymLogo gym={gym} size={72} />
        </View>
        <Text className="gym-hero__name" numberOfLines={2}>{gym.name}</Text>
        {gym.tagline && <Text className="gym-card__meta mt-0.5" numberOfLines={2}>{gym.tagline}</Text>}
        <View className="mt-3 flex-row flex-wrap items-center gap-x-4 gap-y-2">
          {gym.location && (
            <View className="flex-row items-center gap-1">
              <SymbolView name={{ ios: "mappin.and.ellipse", android: "place", web: "place" }} size={14} tintColor={colors.inkSoft} />
              <Text className="gym-card__members">{gym.location}</Text>
            </View>
          )}
          <View className="flex-row items-center gap-1">
            <SymbolView name={{ ios: "person.2", android: "group", web: "group" }} size={14} tintColor={colors.inkSoft} />
            <Text className="gym-card__members">{members(gym.memberCount)}</Text>
          </View>
          {active && gym.membership ? (
            <View className={gym.membership.role === "member" ? "gym-badge gym-badge--member" : "gym-badge gym-badge--staff"}>
              <Text className={gym.membership.role === "member" ? "gym-badge__label" : "gym-badge__label gym-badge__label--staff"}>{roleLabels[gym.membership.role]}</Text>
            </View>
          ) : (
            <View className="gym-badge flex-row items-center gap-1">
              {gym.visibility !== "public" && <SymbolView name={{ ios: "lock", android: "lock", web: "lock" }} size={11} tintColor={colors.inkSoft} />}
              <Text className="gym-badge__label">{gym.visibility !== "public" ? "Private" : gym.joinMode === "join" ? "Open to join" : "Approval required"}</Text>
            </View>
          )}
        </View>

        {active ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-4" style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
            {gym.can.post && (
              <Pressable onPress={() => router.push({ pathname: "/community/compose", params: { gymId: gym.id, gymName: gym.name } })} className="gym-action gym-action--filled" accessibilityRole="button" accessibilityLabel="Create post">
                <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={15} tintColor={colors.white} />
                <Text className="gym-action__label gym-action__label--filled">Create Post</Text>
              </Pressable>
            )}
            {gym.can.invite && (
              <Pressable onPress={() => go("/community/gyms/[id]/invite")} className="gym-action" accessibilityRole="button" accessibilityLabel="Invite">
                <SymbolView name={{ ios: "person.badge.plus", android: "person_add", web: "person_add" }} size={15} tintColor={colors.ink} />
                <Text className="gym-action__label">Invite</Text>
              </Pressable>
            )}
            <Pressable onPress={ask} className="gym-action" accessibilityRole="button" accessibilityLabel="Ask the gym">
              <SymbolView name={{ ios: "sparkles", android: "smart_toy", web: "smart_toy" }} size={15} tintColor={colors.ink} />
              <Text className="gym-action__label">Ask the gym</Text>
            </Pressable>
          </ScrollView>
        ) : (
          <View className="mt-4 flex-row gap-2">
            <Pressable
              onPress={onMembership}
              disabled={busy || button.action === null}
              className={button.action === "join" ? "gym-action gym-action--filled flex-1 justify-center" : "gym-action flex-1 justify-center"}
              style={{ opacity: busy ? 0.5 : 1 }}
              accessibilityRole="button"
              accessibilityLabel={button.action === "cancel" ? "Pending approval. Tap to cancel your request" : button.label}
            >
              {busy ? (
                <ActivityIndicator color={button.action === "join" ? colors.white : colors.ink} />
              ) : (
                <Text className={button.action === "join" ? "gym-action__label gym-action__label--filled" : "gym-action__label"}>{button.action === "cancel" ? "Pending approval · Cancel" : button.label}</Text>
              )}
            </Pressable>
            <Pressable onPress={ask} className="gym-action" accessibilityRole="button" accessibilityLabel="Ask the gym">
              <SymbolView name={{ ios: "sparkles", android: "smart_toy", web: "smart_toy" }} size={15} tintColor={colors.ink} />
              <Text className="gym-action__label">Ask</Text>
            </Pressable>
          </View>
        )}

        <View className="section-tabs mt-6" accessibilityRole="tablist">
          {tabs.map((item) => (
            <Pressable key={item.key} onPress={() => onTab(item.key)} hitSlop={{ top: 6, bottom: 6 }} className={tab === item.key ? "section-tabs__item section-tabs__item--active" : "section-tabs__item"} accessibilityRole="tab" accessibilityState={{ selected: tab === item.key }}>
              <Text className={tab === item.key ? "section-tabs__label section-tabs__label--active" : "section-tabs__label"}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}
