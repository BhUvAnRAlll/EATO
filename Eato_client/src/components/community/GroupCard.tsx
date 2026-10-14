import { Pressable, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";

import { AuthImage } from "@/components/community/AuthImage";
import type { Group } from "@/lib/community";
import { colors } from "@/theme";

type GroupCardProps = {
  group: Group;
  busy?: boolean;
  onOpen: () => void;
  onToggleJoin: () => void;
};

const members = (count: number) =>
  `${count.toLocaleString("en-IN")} ${count === 1 ? "member" : "members"}`;

// A discoverable group: cover or topic tile, name, description, member count, join/leave
export function GroupCard({
  group,
  busy = false,
  onOpen,
  onToggleJoin,
}: GroupCardProps) {
  return (
    <View className="post__card">
      <View className="flex-row items-center gap-3">
        <Pressable
          onPress={onOpen}
          className="flex-1 flex-row items-center gap-3"
          accessibilityRole="button"
          accessibilityLabel={`${group.name}, ${members(group.memberCount)}`}
        >
          {group.coverUrl ? (
            <AuthImage
              path={group.coverUrl}
              style={{ width: 52, height: 52, borderRadius: 14 }}
            />
          ) : (
            <View className="group__tile">
              <SymbolView
                name={{
                  ios: "person.3.fill",
                  android: "groups",
                  web: "groups",
                }}
                size={22}
                tintColor={colors.leaf}
              />
            </View>
          )}
          <View className="flex-1">
            <View className="flex-row items-center gap-2">
              <Text className="post__author" numberOfLines={1}>
                {group.name}
              </Text>
              {group.isPrivate && (
                <SymbolView
                  name={{ ios: "lock.fill", android: "lock", web: "lock" }}
                  size={12}
                  tintColor={colors.muted}
                />
              )}
            </View>
            <Text className="post__time">
              {group.topic} · {members(group.memberCount)}
            </Text>
          </View>
        </Pressable>
        <Pressable
          onPress={onToggleJoin}
          disabled={busy}
          className={
            group.joined ? "group__join group__join--joined" : "group__join"
          }
          style={{ opacity: busy ? 0.5 : 1 }}
          accessibilityRole="button"
          accessibilityLabel={
            group.joined ? `Leave ${group.name}` : `Join ${group.name}`
          }
        >
          <Text
            className={
              group.joined
                ? "group__join-label group__join-label--joined"
                : "group__join-label"
            }
          >
            {group.joined ? "Joined" : "Join"}
          </Text>
        </Pressable>
      </View>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open ${group.name}`}
      >
        <Text className="post__body mt-3" numberOfLines={2}>
          {group.description}
        </Text>
      </Pressable>
    </View>
  );
}
