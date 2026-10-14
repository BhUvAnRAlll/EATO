import { Text, View } from "react-native";

import type { Member } from "@/lib/community";

// Soft pastel tints, picked from the member id so a member always gets the same one
const tints = [
  { background: "#DCE6F5", text: "#2B4C7E" },
  { background: "#E9E4DA", text: "#5A4A2F" },
  { background: "#E6F0E6", text: "#1F5A3C" },
  { background: "#F3E3E4", text: "#8A3A44" },
  { background: "#EDE7F7", text: "#4F3C8C" },
];

export function avatarTint(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return tints[hash % tints.length];
}

// A member's initial in a tinted circle (the app has no profile photos yet)
export function Avatar({ member, size = 44 }: { member: Member; size?: number }) {
  const tint = avatarTint(member.id);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint.background }} className="items-center justify-center" accessibilityLabel={member.name}>
      <Text style={{ color: tint.text, fontSize: Math.round(size * 0.42), lineHeight: Math.round(size * 0.5), fontWeight: "700" }}>{member.initial}</Text>
    </View>
  );
}
