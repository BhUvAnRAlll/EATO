import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { router } from "expo-router";

import { Avatar } from "@/components/community/Avatar";
import { roleLabels } from "@/lib/gymRules";
import type { GymMember } from "@/lib/gyms";
import { colors } from "@/theme";

type GymMembersTabProps = {
  members: GymMember[];
  onMessage: (member: GymMember) => void;
};

// A gym's Members tab: search by name, then Owners & trainers and Members, each in one card.
// Friends get a message button; everyone else a lock, because messaging is for friends only.
export function GymMembersTab({ members, onMessage }: GymMembersTabProps) {
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const shown = term ? members.filter((row) => row.member.name.toLowerCase().includes(term)) : members;
  const staff = shown.filter((row) => row.role !== "member");
  const regular = shown.filter((row) => row.role === "member");

  return (
    <View className="gap-3">
      <View className="search search--pill">
        <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
        <TextInput className="search__input" value={search} onChangeText={setSearch} placeholder="Search members by name" placeholderTextColor={colors.faint} autoCorrect={false} accessibilityLabel="Search members" />
      </View>
      <Text className="home__note">{shown.length === 1 ? "1 member" : `${shown.length} members`}</Text>
      {staff.length > 0 && <Group title={`Owners & trainers · ${staff.length}`} rows={staff} onMessage={onMessage} />}
      {regular.length > 0 && <Group title={`Members · ${regular.length}`} rows={regular} onMessage={onMessage} />}
      {shown.length === 0 && <Text className="home__note">No members match.</Text>}
    </View>
  );
}

function Group({ title, rows, onMessage }: { title: string; rows: GymMember[]; onMessage: (member: GymMember) => void }) {
  return (
    <View className="gap-2">
      <Text className="gym-group__title">{title}</Text>
      <View>
        {rows.map((row, index) => {
          const edge = [index === 0 ? "friend-row--first" : "", index === rows.length - 1 ? "friend-row--last" : ""].join(" ");
          const staff = row.role !== "member";
          return (
            <View key={row.member.id} className={`friend-row ${edge}`}>
              <Avatar member={row.member} size={44} />
              <View className="min-w-0 flex-1">
                <Text className="friend-row__name" numberOfLines={1}>{row.member.name}{row.isMe ? " (you)" : ""}</Text>
                <View className="mt-1 flex-row items-center gap-2">
                  <View className={row.role === "owner" ? "gym-badge gym-badge--staff" : staff ? "gym-badge gym-badge--member" : "gym-badge"} style={{ height: 22 }}>
                    <Text className={row.role === "owner" ? "gym-badge__label gym-badge__label--staff" : "gym-badge__label"} style={{ fontSize: 12 }}>{roleLabels[row.role]}</Text>
                  </View>
                  {row.title && <Text className="friend-row__note flex-1" numberOfLines={1}>{row.title}</Text>}
                </View>
              </View>
              {!row.isMe &&
                (row.friendState === "friends" ? (
                  <Pressable onPress={() => onMessage(row)} hitSlop={8} className="friend-row__icon" accessibilityRole="button" accessibilityLabel={`Message ${row.member.name}`}>
                    <SymbolView name={{ ios: "bubble.left", android: "chat_bubble_outline", web: "chat_bubble_outline" }} size={20} tintColor={colors.ink} />
                  </Pressable>
                ) : (
                  <View className="friend-row__icon" accessibilityLabel={`Messaging ${row.member.name} is locked until you're friends`}>
                    <SymbolView name={{ ios: "lock", android: "lock", web: "lock" }} size={18} tintColor={colors.ink} />
                  </View>
                ))}
              <Pressable onPress={() => router.push({ pathname: "/community/profile/[userId]", params: { userId: row.member.id } })} className="gym-join" accessibilityRole="button" accessibilityLabel={`View ${row.member.name}`}>
                <Text className="gym-join__label">View</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}
