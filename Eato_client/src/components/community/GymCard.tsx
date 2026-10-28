import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";

import { AuthImage } from "@/components/community/AuthImage";
import { membershipButton, roleLabels } from "@/lib/gymRules";
import type { Gym } from "@/lib/gyms";
import { colors } from "@/theme";

type GymAction = "join" | "request" | "cancel";

type GymCardProps = {
  gym: Gym;
  busy?: boolean;
  onOpen: () => void;
  // Join, request, or cancel a request. Leaving is on the gym's About tab, behind a confirmation.
  onAction: (action: GymAction) => void;
};

const members = (count: number) => `${count.toLocaleString("en-IN")} ${count === 1 ? "member" : "members"}`;

// "FF" for FitZone Fitness: the logo stand-in when a gym has no logo
export function gymInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase();
}

export function GymLogo({ gym, size }: { gym: Pick<Gym, "name" | "logoUrl">; size: number }) {
  if (gym.logoUrl) return <AuthImage path={gym.logoUrl} style={{ width: size, height: size, borderRadius: size * 0.24 }} accessibilityLabel={`${gym.name} logo`} />;
  return (
    <View className="gym-logo" style={{ width: size, height: size, borderRadius: size * 0.24 }}>
      <Text className="gym-logo__initials" style={{ fontSize: Math.round(size * 0.36) }}>{gymInitials(gym.name)}</Text>
    </View>
  );
}

function Cover({ gym, height }: { gym: Gym; height: number }) {
  if (gym.coverUrl) return <AuthImage path={gym.coverUrl} style={{ width: "100%", height }} accessibilityLabel={`${gym.name} cover photo`} />;
  return (
    <View className="gym-cover" style={{ height }}>
      <SymbolView name={{ ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" }} size={28} tintColor={colors.faint} />
    </View>
  );
}

// Where the viewer stands, or how the gym takes new members: Owner / Member / Pending ·
// Open to join / Approval required / Private
function StatusBadge({ gym }: { gym: Gym }) {
  const m = gym.membership;
  if (m?.status === "active") {
    return (
      <View className={m.role === "member" ? "gym-badge gym-badge--member" : "gym-badge gym-badge--staff"}>
        <Text className={m.role === "member" ? "gym-badge__label" : "gym-badge__label gym-badge__label--staff"}>{roleLabels[m.role]}</Text>
      </View>
    );
  }
  if (m?.status === "pending") return <View className="gym-badge"><Text className="gym-badge__label">Pending approval</Text></View>;
  if (m?.status === "suspended") return <View className="gym-badge"><Text className="gym-badge__label">Suspended</Text></View>;
  if (gym.visibility !== "public") {
    return (
      <View className="gym-badge flex-row items-center gap-1">
        <SymbolView name={{ ios: "lock", android: "lock", web: "lock" }} size={11} tintColor={colors.inkSoft} />
        <Text className="gym-badge__label">Private</Text>
      </View>
    );
  }
  return <View className="gym-badge"><Text className="gym-badge__label">{gym.joinMode === "join" ? "Open to join" : "Approval required"}</Text></View>;
}

// The list action for a gym: join, ask to join, or withdraw a request (null for a member)
export function joinAction(gym: Gym): GymAction | null {
  const action = membershipButton(gym.membership, gym.joinMode).action;
  return gym.membership?.status === "active" || action === null || action === "leave" ? null : action;
}

function JoinButton({ gym, busy, onAction, wide }: { gym: Gym; busy: boolean; onAction: (action: GymAction) => void; wide?: boolean }) {
  const button = membershipButton(gym.membership, gym.joinMode);
  const action = joinAction(gym);
  if (!action) return null;
  const filled = action === "join";
  return (
    <Pressable
      onPress={() => onAction(action)}
      disabled={busy}
      className={[filled ? "gym-join gym-join--filled" : "gym-join", wide ? "self-stretch" : "self-end"].join(" ")}
      style={{ opacity: busy ? 0.5 : 1 }}
      accessibilityRole="button"
      accessibilityLabel={action === "cancel" ? `Cancel your request to join ${gym.name}` : `${button.label}: ${gym.name}`}
    >
      {busy ? <ActivityIndicator color={filled ? colors.white : colors.ink} /> : <Text className={filled ? "gym-join__label gym-join__label--filled" : "gym-join__label"}>{action === "cancel" ? "Cancel request" : button.label}</Text>}
    </Pressable>
  );
}

// A gym in a list (My Gyms, Explore): cover photo, logo over its edge, name, area, members, the
// viewer's role or how to join, and the join action when there is one
export function GymCard({ gym, busy = false, onOpen, onAction }: GymCardProps) {
  return (
    <View className="gym-card">
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${gym.name}, ${members(gym.memberCount)}`}>
        <Cover gym={gym} height={104} />
        <View className="flex-row items-start gap-3 px-4 pb-4">
          <View className="gym-card__logo">
            <GymLogo gym={gym} size={52} />
          </View>
          <View className="min-w-0 flex-1 pt-2.5">
            <Text className="gym-card__name" numberOfLines={1}>{gym.name}</Text>
            {gym.location && (
              <View className="mt-0.5 flex-row items-center gap-1">
                <SymbolView name={{ ios: "mappin.and.ellipse", android: "place", web: "place" }} size={12} tintColor={colors.faint} />
                <Text className="gym-card__meta" numberOfLines={1}>{gym.location}</Text>
              </View>
            )}
            <View className="mt-2 flex-row flex-wrap items-center gap-2">
              <View className="flex-row items-center gap-1">
                <SymbolView name={{ ios: "person.2", android: "group", web: "group" }} size={13} tintColor={colors.inkSoft} />
                <Text className="gym-card__members">{members(gym.memberCount)}</Text>
              </View>
              <StatusBadge gym={gym} />
            </View>
          </View>
          <View className="pt-6">
            <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={16} tintColor={colors.inkSoft} />
          </View>
        </View>
      </Pressable>
      {joinAction(gym) && (
        <View className="px-4 pb-4" style={{ marginTop: -4 }}>
          <JoinButton gym={gym} busy={busy} onAction={onAction} />
        </View>
      )}
    </View>
  );
}

// The smaller card in the Gyms tab's two-column Explore preview
export function GymTile({ gym, busy = false, onOpen, onAction }: GymCardProps) {
  return (
    <View className="gym-card flex-1">
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${gym.name}, ${members(gym.memberCount)}`}>
        <Cover gym={gym} height={84} />
        <View className="px-3">
          <View className="gym-card__logo gym-card__logo--small">
            <GymLogo gym={gym} size={38} />
          </View>
          <Text className="gym-card__name mt-1.5" numberOfLines={1}>{gym.name}</Text>
          <Text className="gym-card__meta" numberOfLines={1}>{[gym.location, members(gym.memberCount)].filter(Boolean).join(" · ")}</Text>
        </View>
      </Pressable>
      <View className="px-3 pb-3 pt-3">
        <JoinButton gym={gym} busy={busy} onAction={onAction} wide />
        {gym.membership?.status === "active" && (
          <View className="self-start"><StatusBadge gym={gym} /></View>
        )}
      </View>
    </View>
  );
}
