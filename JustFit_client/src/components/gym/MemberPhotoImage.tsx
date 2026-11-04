import { Image } from "expo-image";
import { StyleSheet } from "react-native";

import { getApiUrl } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

// A member's photo filling the avatar spot it sits in (the spot clips it to its shape). Saved
// photos are read from the server with the session token (they are never public); a picked one
// not saved yet is shown from the phone (`uri`). Nothing is drawn without either, so the spot's
// initials or icon show through.
export function MemberPhotoImage({ url, uri }: { url?: string | null; uri?: string | null }) {
  const token = useAuthStore((state) => state.token);
  const source = uri ? { uri } : url && token ? { uri: `${getApiUrl()}${url}`, headers: { Authorization: `Bearer ${token}` }, cacheKey: url } : null;
  if (!source) return null;
  return <Image source={source} contentFit="cover" transition={150} style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors />;
}
