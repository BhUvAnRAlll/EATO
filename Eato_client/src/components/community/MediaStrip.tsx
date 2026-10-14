import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";

import { AuthImage } from "@/components/community/AuthImage";
import { colors } from "@/theme";

// A photo on a draft post: local until it's uploaded, then it has a media id
export type DraftPhoto = {
  key: string;
  uri: string; // local uri, or the server path once it's on the server
  data: string | null; // base64 to upload (null for a photo already on the server)
  mediaType: string | null;
  mediaId: string | null;
  status: "ready" | "uploading" | "done" | "failed";
};

type MediaStripProps = {
  photos: DraftPhoto[];
  disabled?: boolean;
  onRemove: (key: string) => void;
  // Move a photo one place left (-1) or right (+1)
  onMove: (key: string, direction: -1 | 1) => void;
};

const THUMB = 96;

// The chosen photos in order, each with remove and reorder controls and its upload state
export function MediaStrip({ photos, disabled = false, onRemove, onMove }: MediaStripProps) {
  if (photos.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 4 }} keyboardShouldPersistTaps="handled">
      {photos.map((photo, position) => (
        <View key={photo.key} style={{ width: THUMB }} className="gap-1.5">
          <View className="compose__thumb">
            <AuthImage path={photo.uri} style={{ width: THUMB, height: THUMB }} accessibilityLabel={`Photo ${position + 1}`} />
            {photo.status === "uploading" && (
              <View className="compose__thumb-veil">
                <ActivityIndicator color={colors.white} />
              </View>
            )}
            {photo.status === "failed" && (
              <View className="compose__thumb-badge compose__thumb-badge--failed">
                <Text className="compose__thumb-badge-label">Failed</Text>
              </View>
            )}
            {photo.status === "done" && (
              <View className="compose__thumb-badge">
                <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={10} tintColor={colors.white} />
              </View>
            )}
            <Pressable onPress={() => onRemove(photo.key)} disabled={disabled} className="compose__thumb-remove" hitSlop={6} accessibilityRole="button" accessibilityLabel={`Remove photo ${position + 1}`}>
              <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={12} tintColor={colors.white} />
            </Pressable>
          </View>
          <View className="flex-row items-center justify-between">
            <Pressable onPress={() => onMove(photo.key, -1)} disabled={disabled || position === 0} className="compose__thumb-move" style={{ opacity: position === 0 ? 0.35 : 1 }} accessibilityRole="button" accessibilityLabel={`Move photo ${position + 1} left`}>
              <SymbolView name={{ ios: "chevron.left", android: "chevron_left", web: "chevron_left" }} size={14} tintColor={colors.forestInk} />
            </Pressable>
            <Text className="compose__thumb-index">{position + 1}</Text>
            <Pressable onPress={() => onMove(photo.key, 1)} disabled={disabled || position === photos.length - 1} className="compose__thumb-move" style={{ opacity: position === photos.length - 1 ? 0.35 : 1 }} accessibilityRole="button" accessibilityLabel={`Move photo ${position + 1} right`}>
              <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.forestInk} />
            </Pressable>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}
