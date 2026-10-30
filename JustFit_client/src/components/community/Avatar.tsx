import { Text, View } from "react-native";

import type { Member } from "@/lib/community";
import { colors } from "@/theme";
import { fonts } from "@/constants/fonts";

// Soft lavender and grey tints (from the tokens) with near-black initials, picked from the
// member id so a member always gets the same one
const tints = [
  { background: colors.accentSoft, text: colors.ink },
  { background: colors.surfaceAlt, text: colors.ink },
  { background: colors.primary, text: colors.ink },
  { background: colors.creamTab, text: colors.ink },
  { background: colors.infoSoft, text: colors.ink },
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
      <Text style={{ color: tint.text, fontSize: Math.round(size * 0.42), lineHeight: Math.round(size * 0.5), fontFamily: fonts.semibold }}>{member.initial}</Text>
    </View>
  );
}
