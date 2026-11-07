import { Image } from "expo-image";
import { StyleSheet } from "react-native";

import { getApiUrl } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

// A member's photo filling the avatar spot it sits in (the spot clips it to its shape). Saved
// photos are read from the server with the session token (they are never public); a picked one
// not saved yet is shown from the phone (`uri`). Nothing is drawn without either, so the spot's
// initials or icon show through.
// fit: cover for an avatar spot (the default), contain to show a whole bill or brochure.
export function MemberPhotoImage({ url, uri, fit = "cover" }: { url?: string | null; uri?: string | null; fit?: "cover" | "contain" }) {
  const token = useAuthStore((state) => state.token);
  const source = uri ? { uri } : url && token ? { uri: `${getApiUrl()}${url}`, headers: { Authorization: `Bearer ${token}` }, cacheKey: url } : null;
  if (!source) return null;
  return <Image source={source} contentFit={fit} transition={150} style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors />;
}
