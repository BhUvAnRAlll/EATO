import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import * as Crypto from "expo-crypto";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { Avatar } from "@/components/community/Avatar";
import { MediaStrip, type DraftPhoto } from "@/components/community/MediaStrip";
import { PostCard } from "@/components/community/PostCard";
import { FormAlert } from "@/components/FormAlert";
import { audienceLabels, audiencesFor, categoryLabels, community, composeCategories, type Post, type PostAudience, type PostCategory } from "@/lib/community";
import { pickPhotos } from "@/lib/media";
import { useMe } from "@/lib/me";
import { useSessionToken } from "@/lib/session";
import { useCommunityStore } from "@/store/community";
import { colors } from "@/theme";

const MAX_LENGTH = 1000;
const MAX_PHOTOS = 4;

// Create a post (caption, photos, category, audience) with a preview before publishing, or
// edit one of your own (postId param). A group post gets groupId and is shared with the
// group. Publishing uploads each photo, then saves the post with one client key, so a
// double tap or a retry never creates a second post.
export default function ComposePost() {
  const { postId, groupId, groupName } = useLocalSearchParams<{ postId?: string; groupId?: string; groupName?: string }>();
  const { width } = useWindowDimensions();
  const getToken = useSessionToken();
  const me = useMe();
  const upsertPost = useCommunityStore((state) => state.upsertPost);
  const setToken = useCommunityStore((state) => state.setToken);
  const clientKey = useRef(Crypto.randomUUID());

  const [original, setOriginal] = useState<Post | null>(null); // the post being edited
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<PostCategory>("general");
  const [audience, setAudience] = useState<PostAudience>("public");
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [isPrivate, setIsPrivate] = useState<boolean | null>(null); // null until the account is loaded
  const [loading, setLoading] = useState(Boolean(postId));
  const [publishing, setPublishing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  // The account's privacy decides which audiences are offered. Loaded each time the screen
  // is shown, so a change made meanwhile (on the profile) is picked up before publishing.
  const loadAccount = useCallback(async () => {
    const token = await getToken();
    setToken(token);
    const result = await community.me(token);
    if (!result.ok) return;
    setIsPrivate(result.data.profile.isPrivate);
    if (result.data.profile.isPrivate) setAudience((current) => (current === "public" ? "followers" : current));
  }, [getToken, setToken]);

  useFocusEffect(
    useCallback(() => {
      loadAccount();
    }, [loadAccount]),
  );

  // Editing: start from the saved post, its photos already on the server
  useEffect(() => {
    if (!postId) return;
    let cancelled = false;
    (async () => {
      const result = await community.getPost(await getToken(), postId);
      if (cancelled) return;
      if (result.ok) {
        const post = result.data.post;
        setOriginal(post);
        setBody(post.body);
        setCategory(post.category);
        setAudience(post.audience);
        setPhotos(post.media.map((item) => ({ key: item.id, uri: item.url, data: null, mediaType: null, mediaId: item.id, status: "done" })));
      } else setError(result.error);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [postId, getToken]);

  const inGroup = Boolean(groupId || original?.groupId);
  const audiences = audiencesFor(isPrivate === true);
  const busy = publishing || loading;
  const failedPhotos = photos.filter((photo) => photo.status === "failed").length;

  const addPhotos = async (source: "camera" | "library") => {
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) return setError(`A post can have up to ${MAX_PHOTOS} photos.`);
    const picked = await pickPhotos(source, source === "camera" ? 1 : room);
    if (!picked.ok) {
      if (!("cancelled" in picked)) setError(picked.error);
      return;
    }
    setError(null);
    setPhotos((current) => [
      ...current,
      ...picked.photos.map((photo) => ({ key: Crypto.randomUUID(), uri: photo.uri, data: photo.data, mediaType: photo.mediaType, mediaId: null, status: "ready" as const })),
    ]);
  };

  const removePhoto = (key: string) => setPhotos((current) => current.filter((photo) => photo.key !== key));

  const movePhoto = (key: string, direction: -1 | 1) =>
    setPhotos((current) => {
      const from = current.findIndex((photo) => photo.key === key);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });

  // One friendly line, or null when the draft can be published
  const validate = (): string | null => {
    if (!body.trim()) return "Write a caption before publishing.";
    if (body.length > MAX_LENGTH) return `Keep the caption under ${MAX_LENGTH} characters.`;
    if (photos.length > MAX_PHOTOS) return `A post can have up to ${MAX_PHOTOS} photos.`;
    if (!inGroup && isPrivate && audience === "public") return "Your account is private, so choose Followers or Only me.";
    return null;
  };

  const openPreview = () => {
    const problem = validate();
    if (problem) return setError(problem);
    setError(null);
    setPreview(true);
  };

  const publish = async () => {
    if (busy) return;
    const problem = validate();
    if (problem) return setError(problem);
    setPublishing(true);
    setError(null);
    const token = await getToken();

    // 1. Upload the photos that aren't on the server yet, in order. A retry picks up here.
    const uploaded = [...photos];
    const pending = uploaded.filter((photo) => photo.status !== "done").length;
    let done = 0;
    for (let i = 0; i < uploaded.length; i++) {
      const photo = uploaded[i];
      if (photo.status === "done" && photo.mediaId) continue;
      uploaded[i] = { ...photo, status: "uploading" };
      setPhotos([...uploaded]);
      setProgress({ current: done + 1, total: pending });
      const result = await community.uploadImage(token, { data: photo.data ?? "", mediaType: photo.mediaType ?? "" });
      if (!result.ok) {
        uploaded[i] = { ...photo, status: "failed" };
        setPhotos([...uploaded]);
        setProgress(null);
        setPublishing(false);
        setPreview(false);
        return setError(`Photo ${i + 1} couldn't be uploaded: ${result.error} Tap Retry to try again.`);
      }
      uploaded[i] = { ...photo, status: "done", mediaId: result.data.media.id };
      setPhotos([...uploaded]);
      done += 1;
    }
    setProgress(null);

    // 2. Save the post with the uploaded photos (the server checks they're this member's)
    const mediaIds = uploaded.flatMap((photo) => (photo.mediaId ? [photo.mediaId] : []));
    const text = body.trim();
    const result = postId
      ? await community.updatePost(token, postId, { body: text, category, audience, mediaIds })
      : await community.createPost(token, { body: text, category, audience: groupId ? "public" : audience, mediaIds, groupId: groupId ?? null, clientKey: clientKey.current });
    setPublishing(false);
    if (!result.ok) {
      setPreview(false);
      // The account went private while this draft was open: a valid audience is needed now
      if (result.status === 409) {
        setIsPrivate(true);
        setAudience("followers");
      }
      return setError(result.error);
    }
    upsertPost(result.data.post);
    router.back();
  };

  const title = postId ? "Edit Post" : "Create Post";
  const publishLabel = failedPhotos > 0 ? "Retry" : postId ? "Save changes" : "Publish";

  const draft: Post = {
    id: original?.id ?? "draft",
    author: me,
    groupId: groupId ?? original?.groupId ?? null,
    category,
    audience: inGroup ? "public" : audience,
    body: body.trim(),
    imageUrl: photos[0]?.uri ?? null,
    media: photos.map((photo) => ({ id: photo.key, url: photo.uri })),
    likeCount: original?.likeCount ?? 0,
    commentCount: original?.commentCount ?? 0,
    liked: original?.liked ?? false,
    isOwn: true,
    createdAt: original?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const header = (
    <View className="h-12 flex-row items-center px-5">
      <Pressable onPress={() => (preview ? setPreview(false) : router.back())} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
        <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
      </Pressable>
      <Text className="type-subhead ml-3 flex-1 text-forest-ink">{preview ? "Preview" : title}</Text>
    </View>
  );

  const errorLine = error && (
    <Pressable onPress={() => setError(null)} accessibilityLabel="Dismiss error">
      <FormAlert message={error} />
    </Pressable>
  );

  if (preview) {
    return (
      <View className="flex-1 bg-cream">
        <StatusBar style="dark" />
        <SafeAreaView style={{ flex: 1 }}>
          {header}
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 12 }}>
            <Text className="home__note">This is how your post will look.</Text>
            <PostCard post={draft} width={width - 40} onLike={() => {}} onOpenComments={() => {}} onMenu={() => {}} />
            <Text className="home__note">
              {inGroup ? `Shared with ${groupName ?? "the group"}` : `Visible to: ${audienceLabels[audience].label}`}
              {category !== "general" ? ` · ${categoryLabels[category]}` : ""}
              {photos.length > 0 ? ` · ${photos.length} ${photos.length === 1 ? "photo" : "photos"}` : ""}
            </Text>
            {progress && (
              <View className="gap-1.5">
                <Text className="home__note">Uploading photo {progress.current} of {progress.total}</Text>
                <View className="compose__progress">
                  <View className="compose__progress-fill" style={{ width: `${Math.round(((progress.current - 1) / progress.total) * 100)}%` }} />
                </View>
              </View>
            )}
            {errorLine}
          </ScrollView>
          <View className="compose__footer">
            <Pressable onPress={() => setPreview(false)} disabled={busy} className="btn-outline flex-1" accessibilityRole="button">
              <Text className="btn-outline__label">Edit</Text>
            </Pressable>
            <Pressable onPress={publish} disabled={busy} className="btn-forest flex-1" style={{ opacity: busy ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel={publishLabel}>
              {publishing ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">{publishLabel}</Text>}
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        {header}

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
            {loading ? (
              <ActivityIndicator color={colors.forest} className="mt-6" />
            ) : (
              <View className="gap-5">
                <View className="flex-row items-center gap-3">
                  <Avatar member={me} size={44} />
                  <View className="flex-1">
                    <Text className="compose__author" numberOfLines={1}>{me.name}</Text>
                    <Text className="post__time">{inGroup ? `Posting in ${groupName ?? "the group"}` : `Posting to ${audienceLabels[audience].label}`}</Text>
                  </View>
                </View>

                <View>
                  <TextInput
                    className="post__body"
                    value={body}
                    onChangeText={setBody}
                    placeholder="Share your progress..."
                    placeholderTextColor={colors.faint}
                    multiline
                    maxLength={MAX_LENGTH}
                    editable={!busy}
                    style={{ minHeight: 120, textAlignVertical: "top" }}
                    accessibilityLabel="Post text"
                  />
                  <Text className="home__note text-right">{body.length}/{MAX_LENGTH}</Text>
                </View>

                <View className="gap-3">
                  <View className="flex-row items-center justify-between">
                    <Text className="auth__label">Photos</Text>
                    <Text className="home__note">{photos.length}/{MAX_PHOTOS}</Text>
                  </View>
                  <MediaStrip photos={photos} disabled={busy} onRemove={removePhoto} onMove={movePhoto} />
                  <View className="flex-row gap-2">
                    <Pressable onPress={() => addPhotos("camera")} disabled={busy || photos.length >= MAX_PHOTOS} className="admin__action" style={{ opacity: photos.length >= MAX_PHOTOS ? 0.5 : 1 }} accessibilityRole="button" accessibilityLabel="Take photo">
                      <SymbolView name={{ ios: "camera", android: "photo_camera", web: "photo_camera" }} size={16} tintColor={colors.forestInk} />
                      <Text className="admin__action-label">Camera</Text>
                    </Pressable>
                    <Pressable onPress={() => addPhotos("library")} disabled={busy || photos.length >= MAX_PHOTOS} className="admin__action" style={{ opacity: photos.length >= MAX_PHOTOS ? 0.5 : 1 }} accessibilityRole="button" accessibilityLabel="Choose from gallery">
                      <SymbolView name={{ ios: "photo", android: "image", web: "image" }} size={16} tintColor={colors.forestInk} />
                      <Text className="admin__action-label">Gallery</Text>
                    </Pressable>
                  </View>
                  {progress && (
                    <View className="gap-1.5">
                      <Text className="home__note">Uploading photo {progress.current} of {progress.total}</Text>
                      <View className="compose__progress">
                        <View className="compose__progress-fill" style={{ width: `${Math.round(((progress.current - 1) / progress.total) * 100)}%` }} />
                      </View>
                    </View>
                  )}
                </View>

                <View>
                  <Text className="auth__label mb-2">Category (optional)</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {composeCategories.map((item) => (
                      <Pressable key={item} onPress={() => setCategory(item)} disabled={busy} className={category === item ? "setup__chip setup__chip--selected" : "setup__chip"} accessibilityRole="radio" accessibilityState={{ selected: category === item }}>
                        <Text className={category === item ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{categoryLabels[item]}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                {inGroup ? (
                  <Text className="home__note">Shared with everyone in the group.</Text>
                ) : (
                  <View>
                    <Text className="auth__label mb-2">Who can see this</Text>
                    <View className="flex-row flex-wrap gap-2">
                      {audiences.map((item) => (
                        <Pressable key={item} onPress={() => setAudience(item)} disabled={busy} className={audience === item ? "setup__chip setup__chip--selected" : "setup__chip"} accessibilityRole="radio" accessibilityState={{ selected: audience === item }} accessibilityLabel={`Audience: ${audienceLabels[item].label}`}>
                          <Text className={audience === item ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{audienceLabels[item].label}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <Text className="home__note mt-2">{isPrivate ? "Your account is private, so posts can't be shared with everyone." : audienceLabels[audience].hint}</Text>
                  </View>
                )}

                {errorLine}
              </View>
            )}
          </ScrollView>

          <View className="compose__footer">
            <Pressable onPress={openPreview} disabled={busy} className="btn-outline flex-1" accessibilityRole="button" accessibilityLabel="Preview">
              <Text className="btn-outline__label">Preview</Text>
            </Pressable>
            <Pressable onPress={publish} disabled={busy} className="btn-forest flex-1" style={{ opacity: busy ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel={publishLabel}>
              {publishing ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">{publishLabel}</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
