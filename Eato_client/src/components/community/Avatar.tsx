import { Text, View } from "react-native";

import type { Member } from "@/lib/community";

// Soft periwinkle and warm-grey tints with near-black initials, picked from the member id
// so a member always gets the same one
const tints = [
  { background: "#E2EBF6", text: "#141515" },
  { background: "#EDE7E3", text: "#141515" },
  { background: "#C5D3EA", text: "#141515" },
  { background: "#E9E6E2", text: "#141515" },
  { background: "#F6F2EF", text: "#141515" },
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
