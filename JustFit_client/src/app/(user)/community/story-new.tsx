import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { community, storyAudienceLabels, storyAudiencesFor, type StoryAudience } from "@/lib/community";
import { pickPhotos, type PickedPhoto } from "@/lib/media";
import { SESSION_EXPIRED_MESSAGE, isSessionExpired, returnToSignIn, useSessionToken } from "@/lib/session";
import { useCommunityStore } from "@/store/community";
import { colors } from "@/theme";

const MAX_CAPTION = 200;

// Add a story: pick a photo (camera or gallery), preview it, add an optional caption, choose
// who sees it, then Share. The photo is uploaded first; if that fails, Retry uploads it again,
// and once it is up a retry only re-sends the story (the server answers a repeat with the
// story it already made, so a Retry after a lost response never posts twice). The draft
// stays on screen after any failure. Stories end after 24 hours; a member can have several.
export default function NewStory() {
  const { width } = useWindowDimensions();
  const getToken = useSessionToken();
  const setToken = useCommunityStore((state) => state.setToken);
  const addStory = useCommunityStore((state) => state.addStory);
  const loadStories = useCommunityStore((state) => state.loadStories);
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [audience, setAudience] = useState<StoryAudience>("public");
  const [isPrivate, setIsPrivate] = useState(false);
  const [closeCount, setCloseCount] = useState<number | null>(null);
  const [stage, setStage] = useState<"idle" | "uploading" | "sharing">("idle");
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  // Set before the first await, so a second tap can't start a second share while the
  // button's disabled state is still catching up
  const sharing = useRef(false);

  // The account's privacy decides the audiences on offer; reloaded whenever the screen shows,
  // so a change made meanwhile (or on the Close Friends screen) is picked up
  const loadAccount = useCallback(async () => {
    const token = await getToken();
    setToken(token);
    const [me, friends] = await Promise.all([community.me(token), community.closeFriends(token)]);
    if (me.ok) {
      setIsPrivate(me.data.profile.isPrivate);
      if (me.data.profile.isPrivate) setAudience((current) => (current === "public" ? "followers" : current));
    }
    if (friends.ok) setCloseCount(friends.data.members.filter((entry) => entry.isCloseFriend).length);
  }, [getToken, setToken]);

  useFocusEffect(
    useCallback(() => {
      loadAccount();
    }, [loadAccount]),
  );

  const busy = stage !== "idle";

  const choose = async (source: "camera" | "library") => {
    const picked = await pickPhotos(source, 1);
    if (!picked.ok) {
      if (!("cancelled" in picked)) setError(picked.error);
      return;
    }
    setPhoto(picked.photos[0]);
    setUploadedId(null);
    setFailed(false);
    setError(null);
  };

  // One failed step: an ended session offers sign-in; anything else keeps the draft for Retry
  const showFailure = (result: { error: string; status?: number }, message: string) => {
    setFailed(true);
    if (isSessionExpired({ ok: false, status: result.status })) {
      setSessionExpired(true);
      return setError(SESSION_EXPIRED_MESSAGE);
    }
    setError(message);
  };

  const share = async () => {
    if (sharing.current || busy) return;
    if (!photo) return setError("Choose a photo for your story.");
    if (isPrivate && audience === "public") return setError("Your account is private, so choose Followers or Close Friends.");
    sharing.current = true;
    setError(null);
    setSessionExpired(false);
    try {
      const token = await getToken();
      let mediaId = uploadedId;
      if (!mediaId) {
        setStage("uploading");
        const upload = await community.uploadImage(token, { data: photo.data, mediaType: photo.mediaType });
        if (!upload.ok) return showFailure(upload, `Your photo couldn't be uploaded: ${upload.error} Tap Retry to try again.`);
        mediaId = upload.data.media.id;
        setUploadedId(mediaId);
      }
      setStage("sharing");
      const result = await community.createStory(token, { mediaId, caption: caption.trim() || null, audience });
      if (!result.ok) {
        // The account went private while this screen was open: a valid audience is needed now
        if (result.status === 409) {
          setIsPrivate(true);
          setAudience("followers");
        }
        return showFailure(result, result.error);
      }
      // Up in the row at once; the refresh then brings the server's full row
      addStory(result.data.story);
      await loadStories(token);
      router.back();
    } catch {
      showFailure({ error: "" }, "Something went wrong. Check your connection and tap Retry.");
    } finally {
      sharing.current = false;
      setStage("idle");
    }
  };

  const previewWidth = width - 32;

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={() => router.back()} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title" numberOfLines={1}>New story</Text>
          <View className="screen-bar__spacer" />
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, gap: 18 }} keyboardShouldPersistTaps="handled">
          {photo ? (
            <View className="gap-2">
              <Image source={{ uri: photo.uri }} contentFit="cover" style={{ width: previewWidth, height: Math.round(previewWidth * 1.25), borderRadius: 20 }} accessibilityLabel="Story preview" />
              <Pressable onPress={() => choose("library")} disabled={busy} className="admin__action self-start" accessibilityRole="button" accessibilityLabel="Choose another photo">
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
                <Pressable onPress={() => choose("camera")} className="admin__action" accessibilityRole="button" accessibilityLabel="Take photo">
                  <SymbolView name={{ ios: "camera", android: "photo_camera", web: "photo_camera" }} size={16} tintColor={colors.forestInk} />
                  <Text className="admin__action-label">Camera</Text>
                </Pressable>
                <Pressable onPress={() => choose("library")} className="admin__action" accessibilityRole="button" accessibilityLabel="Choose from gallery">
                  <SymbolView name={{ ios: "photo", android: "image", web: "image" }} size={16} tintColor={colors.forestInk} />
                  <Text className="admin__action-label">Gallery</Text>
                </Pressable>
              </View>
            </View>
          )}

          <TextInput className="admin__input" value={caption} onChangeText={setCaption} editable={!busy} placeholder="Add a caption (optional)" placeholderTextColor={colors.faint} maxLength={MAX_CAPTION} accessibilityLabel="Caption" />

          <View>
            <Text className="auth__label mb-2">Who can see this</Text>
            <View className="flex-row flex-wrap gap-2">
              {storyAudiencesFor(isPrivate).map((item) => (
                <Pressable key={item} onPress={() => setAudience(item)} disabled={busy} className={audience === item ? "setup__chip setup__chip--selected" : "setup__chip"} accessibilityRole="radio" accessibilityState={{ selected: audience === item }} accessibilityLabel={`Audience: ${storyAudienceLabels[item].label}`}>
                  <Text className={audience === item ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{storyAudienceLabels[item].label}</Text>
                </Pressable>
              ))}
            </View>
            <Text className="home__note mt-2">{isPrivate && audience !== "close_friends" ? "Your account is private, so stories can't be shared with everyone." : storyAudienceLabels[audience].hint}</Text>
            {audience === "close_friends" && (
              <Pressable onPress={() => router.push("/community/close-friends")} className="mt-2 flex-row items-center gap-1.5 self-start" accessibilityRole="button" accessibilityLabel="Edit Close Friends">
                <Text className="auth__link">{closeCount === null ? "Edit Close Friends" : closeCount === 0 ? "Your list is empty, so only you will see this. Add people" : `${closeCount} ${closeCount === 1 ? "person" : "people"} · Edit list`}</Text>
              </Pressable>
            )}
          </View>

          {error && (
            <View>
              <Pressable onPress={() => setError(null)} accessibilityLabel="Dismiss error">
                <FormAlert message={error} />
              </Pressable>
              {sessionExpired && (
                <Pressable onPress={() => returnToSignIn()} className="btn-outline mt-3" accessibilityRole="button" accessibilityLabel="Sign in again">
                  <Text className="btn-outline__label">Sign in again</Text>
                </Pressable>
              )}
            </View>
          )}
        </ScrollView>

        <View className="compose__footer">
          <Pressable onPress={share} disabled={busy || !photo} className="btn-forest flex-1" style={{ opacity: busy || !photo ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel={failed ? "Retry" : "Share story"}>
            {busy ? (
              <View className="flex-row items-center gap-2">
                <ActivityIndicator color={colors.white} />
                <Text className="btn-forest__label">{stage === "uploading" ? "Uploading photo…" : "Sharing…"}</Text>
              </View>
            ) : (
              <Text className="btn-forest__label">{failed ? "Retry" : "Share story"}</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
