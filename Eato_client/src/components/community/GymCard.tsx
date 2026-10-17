import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";

import { AuthImage } from "@/components/community/AuthImage";
import { membershipButton } from "@/lib/gymRules";
import type { Gym } from "@/lib/gyms";
import { colors } from "@/theme";

type GymCardProps = {
  gym: Gym;
  busy?: boolean;
  onOpen: () => void;
  // Join, request, or cancel a request. Leaving is on the gym's About tab, behind a confirmation.
  onAction: (action: "join" | "request" | "cancel") => void;
};

const members = (count: number) => `${count.toLocaleString("en-IN")} ${count === 1 ? "member" : "members"}`;

// A gym in a list: logo (or a dumbbell tile), name, area and members, and where the viewer stands
export function GymCard({ gym, busy = false, onOpen, onAction }: GymCardProps) {
  const button = membershipButton(gym.membership, gym.joinMode);
  const action = button.action === "leave" ? null : button.action;
  return (
    <View className="post__card">
      <View className="flex-row items-center gap-3">
        <Pressable onPress={onOpen} className="flex-1 flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel={`${gym.name}, ${members(gym.memberCount)}`}>
          {gym.logoUrl ? (
            <AuthImage path={gym.logoUrl} style={{ width: 52, height: 52, borderRadius: 14 }} />
          ) : (
            <View className="group__tile">
              <SymbolView name={{ ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" }} size={22} tintColor={colors.leaf} />
            </View>
          )}
          <View className="flex-1">
            <View className="flex-row items-center gap-2">
              <Text className="post__author flex-shrink" numberOfLines={1}>{gym.name}</Text>
              {gym.visibility !== "public" && <SymbolView name={{ ios: "lock.fill", android: "lock", web: "lock" }} size={12} tintColor={colors.muted} />}
            </View>
            <Text className="post__time" numberOfLines={1}>{[gym.location, members(gym.memberCount)].filter(Boolean).join(" · ")}</Text>
          </View>
        </Pressable>
        <Pressable
          onPress={action ? () => onAction(action) : onOpen}
          disabled={busy}
          className={button.tone === "primary" ? "group__join" : "group__join group__join--joined"}
          style={{ opacity: busy ? 0.5 : 1 }}
          accessibilityRole="button"
          accessibilityLabel={action === "cancel" ? `Cancel your request to join ${gym.name}` : action ? `${button.label}: ${gym.name}` : `Open ${gym.name}`}
        >
          {busy ? <ActivityIndicator color={button.tone === "primary" ? colors.white : colors.forest} /> : <Text className={button.tone === "primary" ? "group__join-label" : "group__join-label group__join-label--joined"}>{button.label}</Text>}
        </Pressable>
      </View>
      {gym.tagline && (
        <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Open ${gym.name}`}>
          <Text className="post__body mt-3" numberOfLines={2}>{gym.tagline}</Text>
        </Pressable>
      )}
    </View>
  );
}
