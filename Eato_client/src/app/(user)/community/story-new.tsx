import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { community } from "@/lib/community";
import { pickReport, type PickedReport } from "@/lib/reportUpload";
import { useSessionToken } from "@/lib/session";
import { useCommunityStore } from "@/store/community";
import { colors } from "@/theme";

const MAX_CAPTION = 200;

// Add a story: a photo with an optional caption, visible to the community for 24 hours
export default function NewStory() {
  const { width } = useWindowDimensions();
  const getToken = useSessionToken();
  const loadFeed = useCommunityStore((state) => state.loadFeed);
  const [photo, setPhoto] = useState<PickedReport | null>(null);
  const [caption, setCaption] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choosePhoto = async (source: "camera" | "library") => {
    const picked = await pickReport(source);
    if (picked.ok) setPhoto(picked.file);
    else if (!("cancelled" in picked)) setError(picked.error);
  };

  const share = async () => {
    if (!photo || saving) return;
    setSaving(true);
    setError(null);
    const token = await getToken();
    const upload = await community.uploadImage(token, photo);
    if (!upload.ok) {
      setSaving(false);
      return setError(upload.error);
    }
    const result = await community.createStory(token, { mediaId: upload.data.media.id, caption: caption.trim() || null });
    setSaving(false);
    if (!result.ok) return setError(result.error);
    await loadFeed(token, { force: true });
    router.back();
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="h-12 flex-row items-center px-5">
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Cancel">
            <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={20} tintColor={colors.forestInk} />
          </Pressable>
          <Text className="type-subhead ml-3 flex-1 text-forest-ink">New story</Text>
          <Pressable onPress={share} disabled={!photo || saving} className="admin__action admin__action--primary" style={{ opacity: photo && !saving ? 1 : 0.5 }} accessibilityRole="button">
            {saving ? <ActivityIndicator color={colors.white} /> : <Text className="admin__action-label admin__action-label--primary">Share</Text>}
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
          {photo ? (
            <View>
              <Image source={{ uri: `data:${photo.mediaType};base64,${photo.data}` }} contentFit="cover" style={{ width: width - 40, height: Math.round((width - 40) * 1.25), borderRadius: 20 }} />
              <Pressable onPress={() => setPhoto(null)} className="admin__action mt-2 self-start" accessibilityRole="button">
                <Text className="admin__action-label">Choose another</Text>
              </Pressable>
            </View>
          ) : (
            <View className="upload__card">
              <View className="upload__icon">
                <SymbolView name={{ ios: "camera.fill", android: "photo_camera", web: "photo_camera" }} size={30} tintColor={colors.forest} />
              </View>
              <Text className="upload__title mt-4">Add a photo</Text>
              <Text className="upload__text mt-1">Your story stays up for 24 hours.</Text>
              <View className="mt-4 flex-row gap-2">
                <Pressable onPress={() => choosePhoto("camera")} className="admin__action" accessibilityRole="button">
                  <Text className="admin__action-label">Take photo</Text>
                </Pressable>
                <Pressable onPress={() => choosePhoto("library")} className="admin__action" accessibilityRole="button">
                  <Text className="admin__action-label">Choose from gallery</Text>
                </Pressable>
              </View>
            </View>
          )}
          <TextInput className="admin__input" value={caption} onChangeText={setCaption} placeholder="Add a caption (optional)" placeholderTextColor={colors.faint} maxLength={MAX_CAPTION} accessibilityLabel="Caption" />
          {error && <FormAlert message={error} />}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
