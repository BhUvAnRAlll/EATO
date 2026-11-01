import { Text, View } from "react-native";

import { colors, Palette } from "@/theme";
import { fonts } from "@/constants/fonts";

// Who an avatar shows: an account id (picks the tint), a name and its initial
export type AvatarPerson = { id: string; name: string; initial: string };

// Soft lavender and grey tints (from the tokens) with near-black initials, picked from the
// member id so a member always gets the same one
const tints = (colors: Palette) => ([
  { background: colors.accentSoft, text: colors.ink },
  { background: colors.surfaceAlt, text: colors.ink },
  { background: colors.primary, text: colors.white },
  { background: colors.creamTab, text: colors.ink },
  { background: colors.infoSoft, text: colors.ink },
]);

export function avatarTint(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return tints(colors)[hash % tints(colors).length];
}

// A member's initial in a tinted circle (the app has no profile photos yet)
export function Avatar({ member, size = 44 }: { member: AvatarPerson; size?: number }) {
  const tint = avatarTint(member.id);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint.background }} className="items-center justify-center" accessibilityLabel={member.name}>
      <Text style={{ color: tint.text, fontSize: Math.round(size * 0.42), lineHeight: Math.round(size * 0.5), fontFamily: fonts.semibold }}>{member.initial}</Text>
    </View>
  );
}
