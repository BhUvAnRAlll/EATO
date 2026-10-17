import { useState } from "react";
import { View, type ImageStyle, type StyleProp } from "react-native";
import { Image, type ImageContentFit } from "expo-image";
import { SymbolView } from "expo-symbols";

import { getApiUrl } from "@/lib/api";
import { useCommunityStore } from "@/store/community";
import { colors } from "@/theme";

type AuthImageProps = {
  // A server path such as "/api/media/<id>", or a local uri (file:, data:, blob:) for a photo
  // that hasn't been uploaded yet
  path: string | null;
  style: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
  accessibilityLabel?: string;
};

// A member-uploaded image. The server only serves images to signed-in members, so the
// session token travels in the request headers; a failed load shows a soft placeholder. The
// failure is remembered for the path that failed, so the same component showing a new path
// (the story viewer moving to the next story) tries again.
export function AuthImage({ path, style, contentFit = "cover", accessibilityLabel }: AuthImageProps) {
  const token = useCommunityStore((state) => state.token);
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const failed = failedPath !== null && failedPath === path;
  const onServer = path?.startsWith("/") ?? false;

  if (!path || failed || (onServer && !token)) {
    return (
      <View style={style} className="items-center justify-center bg-cream-tab">
        <SymbolView name={{ ios: "photo", android: "image", web: "image" }} size={24} tintColor={colors.faint} />
      </View>
    );
  }
  return (
    <Image
      source={onServer ? { uri: `${getApiUrl()}${path}`, headers: { Authorization: `Bearer ${token}` } } : { uri: path }}
      cachePolicy={onServer ? "memory-disk" : "none"}
      contentFit={contentFit}
      transition={150}
      style={style}
      onError={() => setFailedPath(path)}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
