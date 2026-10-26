import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import * as Crypto from "expo-crypto";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { ActionSheet } from "@/components/community/ActionSheet";
import { Avatar } from "@/components/community/Avatar";
import { MediaStrip, type DraftPhoto } from "@/components/community/MediaStrip";
import { TagPeopleSheet } from "@/components/community/TagPeopleSheet";
import { FormAlert } from "@/components/FormAlert";
import { audienceLabels, audiencesFor, categoryLabels, community, postTypes, type Member, type NewPost, type Post, type PostAudience, type PostCategory, type PostType } from "@/lib/community";
import { gyms } from "@/lib/gyms";
import { pickPhotos } from "@/lib/media";
import { useMe } from "@/lib/me";
import { useSessionToken } from "@/lib/session";
import { useCommunityStore } from "@/store/community";
import { colors } from "@/theme";

const MAX_LENGTH = 1000;
const MAX_PHOTOS = 4;
const MAX_POLL_OPTIONS = 6;

// Where a new post goes: your feed, or a gym you may post in
type Place = { kind: "feed" } | { kind: "gym"; id: string; name: string };

const typeLabels: Record<PostCategory, string> = { ...categoryLabels, general: "Text" };
const audienceIcons = {
  public: { ios: "globe", android: "public", web: "public" },
  followers: { ios: "person.2", android: "group", web: "group" },
  only_me: { ios: "lock", android: "lock", web: "lock" },
} as const;

// Whole numbers only ("" means not given)
const wholeOrNull = (value: string) => (value.trim() === "" ? null : Number(value.trim()));

// Create Post: where it goes (your feed or a gym), the type (Photo, Progress, Meal,
// Achievement, Question, Poll) and that type's fields, a caption, photos, an optional location,
// tagged friends and the audience. Editing (postId) keeps the post's place and type. Publishing
// uploads each photo first, then saves the post with one client key, so a double tap or a retry
// never creates a second post. The server checks every rule again.
export default function ComposePost() {
  const { postId, gymId, gymName, type: startType } = useLocalSearchParams<{ postId?: string; gymId?: string; gymName?: string; type?: string }>();
  const getToken = useSessionToken();
  const me = useMe();
  const upsertPost = useCommunityStore((state) => state.upsertPost);
  const setToken = useCommunityStore((state) => state.setToken);
  const clientKey = useRef(Crypto.randomUUID());

  const [original, setOriginal] = useState<Post | null>(null); // the post being edited
  const [place, setPlace] = useState<Place>(gymId ? { kind: "gym", id: gymId, name: gymName ?? "the gym" } : { kind: "feed" });
  const [postableGyms, setPostableGyms] = useState<{ id: string; name: string }[]>([]);
  // A shortcut can open Create Post on a type (the gym feed's Photo, Achievement and Poll)
  const [type, setType] = useState<PostCategory>(postTypes.includes(startType as PostType) ? (startType as PostType) : "photo");
  const [body, setBody] = useState("");
  const [headline, setHeadline] = useState("");
  const [detail, setDetail] = useState("");
  const [detailDate, setDetailDate] = useState("");
  const [mealKcal, setMealKcal] = useState("");
  const [mealProtein, setMealProtein] = useState("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [location, setLocation] = useState("");
  const [showLocation, setShowLocation] = useState(false);
  const [tagged, setTagged] = useState<Member[]>([]);
  const [audience, setAudience] = useState<PostAudience>("public");
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [isPrivate, setIsPrivate] = useState<boolean | null>(null); // null until the account is loaded
  const [sheet, setSheet] = useState<"place" | "audience" | "photo" | "tags" | null>(null);
  const [loading, setLoading] = useState(Boolean(postId));
  const [publishing, setPublishing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  // A new post can go to any gym where you may post (the server checks again)
  useEffect(() => {
    if (postId) return;
    let cancelled = false;
    (async () => {
      const result = await gyms.list(await getToken());
      if (!cancelled && result.ok) setPostableGyms(result.data.mine.filter((gym) => gym.can.post).map((gym) => ({ id: gym.id, name: gym.name })));
    })();
    return () => {
      cancelled = true;
    };
  }, [postId, getToken]);

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
        setType(post.category);
        setBody(post.body);
        setHeadline(post.headline ?? "");
        setDetail(post.detail ?? "");
        setDetailDate(post.detailDate ?? "");
        setMealKcal(post.mealKcal === null ? "" : String(post.mealKcal));
        setMealProtein(post.mealProteinG === null ? "" : String(post.mealProteinG));
        setLocation(post.location ?? "");
        setShowLocation(Boolean(post.location));
        setTagged(post.tagged);
        setAudience(post.audience);
        setPhotos(post.media.map((item) => ({ key: item.id, uri: item.url, data: null, mediaType: null, mediaId: item.id, status: "done" })));
      } else setError(result.error);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [postId, getToken]);

  const editing = Boolean(postId);
  // A gym post (or an older group post) is shared with that gym or group, so it has no audience choice
  const inPlace = editing ? Boolean(original?.gymId) : place.kind === "gym";
  const placeName = editing ? gymName ?? "the gym" : place.kind === "gym" ? place.name : "My JustFit feed";
  const audiences = audiencesFor(isPrivate === true);
  const busy = publishing || loading;
  const failedPhotos = photos.filter((photo) => photo.status === "failed").length;
  const hasTitle = type === "progress" || type === "meal" || type === "achievement";
  const captionRequired = type === "general" || type === "workout" || type === "question" || type === "poll";
  const takesPhotos = type !== "poll";

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

  // One friendly line, or null when the draft can be published (the server checks again)
  const validate = (): string | null => {
    if (captionRequired && !body.trim()) return type === "question" ? "Write your question." : type === "poll" ? "Write the poll question." : "Write a caption before publishing.";
    if (body.length > MAX_LENGTH) return `Keep the caption under ${MAX_LENGTH} characters.`;
    // An older meal or progress post may have no title: editing its caption doesn't force one
    if (hasTitle && !headline.trim() && !(editing && !original?.headline)) return type === "meal" ? "Add the meal's name." : "Add a title.";
    if (type === "photo" && photos.length === 0) return "Add at least one photo.";
    if (photos.length > MAX_PHOTOS) return `A post can have up to ${MAX_PHOTOS} photos.`;
    if (type === "progress" && detailDate.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(detailDate.trim())) return "Write the date as YYYY-MM-DD.";
    if (type === "meal") {
      for (const [value, label, max] of [[mealKcal, "Calories", 5000], [mealProtein, "Protein", 500]] as const) {
        const n = wholeOrNull(value);
        if (n !== null && (!Number.isInteger(n) || n < 0 || n > max)) return `${label} must be a whole number from 0 to ${max}.`;
      }
    }
    if (type === "poll" && !editing) {
      const options = pollOptions.map((option) => option.trim());
      if (options.some((option) => option === "")) return "Fill in every poll option, or remove the empty ones.";
      if (options.length < 2) return "A poll needs at least 2 options.";
      if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) return "Each poll option must be different.";
    }
    if (!inPlace && isPrivate && audience === "public") return "Your account is private, so choose Followers or Only me.";
    return null;
  };

  // The type's details, as the server expects them (only the fields that type uses)
  const details = () => {
    if (type === "progress") return { headline: headline.trim(), detail: detail.trim() || null, detailDate: detailDate.trim() || null };
    if (type === "meal") return { headline: headline.trim(), mealKcal: wholeOrNull(mealKcal), mealProteinG: wholeOrNull(mealProtein) };
    if (type === "achievement") return { headline: headline.trim(), detail: detail.trim() || null };
    return {};
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
        return setError(`Photo ${i + 1} couldn't be uploaded: ${result.error} Tap Retry to try again.`);
      }
      uploaded[i] = { ...photo, status: "done", mediaId: result.data.media.id };
      setPhotos([...uploaded]);
      done += 1;
    }
    setProgress(null);

    // 2. Save the post with the uploaded photos (the server checks they're this member's)
    const mediaIds = takesPhotos ? uploaded.flatMap((photo) => (photo.mediaId ? [photo.mediaId] : [])) : [];
    const text = body.trim();
    const where = location.trim() || null;
    const draft: NewPost = {
      body: text,
      category: type,
      mediaIds,
      location: where,
      taggedUserIds: tagged.map((member) => member.id),
      clientKey: clientKey.current,
      ...details(),
      ...(type === "poll" ? { pollOptions: pollOptions.map((option) => option.trim()) } : {}),
    };
    const result = postId
      ? await community.updatePost(token, postId, { body: text, mediaIds, location: where, ...(inPlace ? {} : { audience }), ...details() })
      : place.kind === "gym"
        ? await gyms.createPost(token, place.id, draft)
        : await community.createPost(token, { ...draft, audience });
    setPublishing(false);
    if (!result.ok) {
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

  const publishLabel = failedPhotos > 0 ? "Retry" : editing ? "Save changes" : "Post";

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={() => router.back()} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title">{editing ? "Edit Post" : "Create Post"}</Text>
          <View className="screen-bar__back" />
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          {loading ? (
            <ActivityIndicator color={colors.forest} className="mt-6" />
          ) : (
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 18 }} keyboardShouldPersistTaps="handled">
              {/* Posting to: your feed or a gym (fixed when editing) */}
              <Pressable
                onPress={() => setSheet("place")}
                disabled={editing || busy || postableGyms.length === 0}
                className="compose__place"
                accessibilityRole="button"
                accessibilityLabel={`Posting to ${placeName}`}
              >
                <Avatar member={me} size={40} />
                <View className="min-w-0 flex-1">
                  <Text className="compose__place-kicker">Posting to</Text>
                  <Text className="compose__place-name" numberOfLines={1}>{placeName}</Text>
                </View>
                {!editing && postableGyms.length > 0 && <SymbolView name={{ ios: "chevron.down", android: "expand_more", web: "expand_more" }} size={16} tintColor={colors.ink} />}
              </Pressable>

              {/* Post type (fixed when editing) */}
              {editing ? (
                <Text className="home__note">Post type: {typeLabels[type]}</Text>
              ) : (
                <View className="gap-2">
                  <Text className="compose__label">Post type</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginHorizontal: -20 }}>
                    <View className="w-3" />
                    {postTypes.map((item) => (
                      <Pressable key={item} onPress={() => { setType(item); setError(null); }} disabled={busy} className={type === item ? "compose__type compose__type--selected" : "compose__type"} accessibilityRole="radio" accessibilityState={{ selected: type === item }} accessibilityLabel={`Post type: ${typeLabels[item]}`}>
                        <Text className={type === item ? "compose__type-label compose__type-label--selected" : "compose__type-label"}>{typeLabels[item]}</Text>
                      </Pressable>
                    ))}
                    <View className="w-3" />
                  </ScrollView>
                </View>
              )}

              {/* The type's own fields */}
              {hasTitle && (
                <View className="gap-2">
                  <Text className="compose__label">{type === "meal" ? "Meal name" : "Title"}</Text>
                  <TextInput className="compose__input" value={headline} onChangeText={setHeadline} maxLength={120} editable={!busy} placeholder={type === "meal" ? "Paneer tikka bowl" : type === "progress" ? "Week 12 check-in" : "First pull-up"} placeholderTextColor={colors.faint} accessibilityLabel={type === "meal" ? "Meal name" : "Title"} />
                </View>
              )}
              {type === "progress" && (
                <View className="flex-row gap-3">
                  <View className="min-w-0 flex-1 gap-2">
                    <Text className="compose__label">Milestone <Text className="setup__optional">(optional)</Text></Text>
                    <TextInput className="compose__input" value={detail} onChangeText={setDetail} maxLength={120} editable={!busy} placeholder="-6 kg" placeholderTextColor={colors.faint} accessibilityLabel="Milestone" />
                  </View>
                  <View className="w-32 gap-2">
                    <Text className="compose__label">Date <Text className="setup__optional">(optional)</Text></Text>
                    <TextInput className="compose__input" value={detailDate} onChangeText={setDetailDate} maxLength={10} editable={!busy} placeholder="YYYY-MM-DD" placeholderTextColor={colors.faint} keyboardType="numbers-and-punctuation" accessibilityLabel="Date" />
                  </View>
                </View>
              )}
              {type === "meal" && (
                <View className="gap-2">
                  <View className="flex-row gap-3">
                    <View className="min-w-0 flex-1 gap-2">
                      <Text className="compose__label">Calories <Text className="setup__optional">(optional)</Text></Text>
                      <TextInput className="compose__input" value={mealKcal} onChangeText={setMealKcal} maxLength={4} editable={!busy} placeholder="kcal" placeholderTextColor={colors.faint} keyboardType="number-pad" accessibilityLabel="Calories" />
                    </View>
                    <View className="min-w-0 flex-1 gap-2">
                      <Text className="compose__label">Protein <Text className="setup__optional">(optional)</Text></Text>
                      <TextInput className="compose__input" value={mealProtein} onChangeText={setMealProtein} maxLength={3} editable={!busy} placeholder="g" placeholderTextColor={colors.faint} keyboardType="number-pad" accessibilityLabel="Protein" />
                    </View>
                  </View>
                  <Text className="home__note">Sharing a meal doesn&apos;t log it to your Macro diary.</Text>
                </View>
              )}
              {type === "achievement" && (
                <View className="gap-2">
                  <Text className="compose__label">Description <Text className="setup__optional">(optional)</Text></Text>
                  <TextInput className="compose__input" value={detail} onChangeText={setDetail} maxLength={300} editable={!busy} placeholder="Six months of trying" placeholderTextColor={colors.faint} accessibilityLabel="Description" />
                </View>
              )}

              {/* Caption (the question itself on a question or poll) */}
              <View className="gap-2">
                <Text className="compose__label">
                  {type === "question" ? "Question" : type === "poll" ? "Poll question" : "Caption"}
                  {captionRequired ? <Text className="compose__required"> *</Text> : null}
                </Text>
                <TextInput
                  className="compose__caption"
                  value={body}
                  onChangeText={setBody}
                  placeholder={type === "question" ? "What would you like to ask?" : type === "poll" ? "What should people vote on?" : "Share what you've been working on..."}
                  placeholderTextColor={colors.faint}
                  multiline
                  maxLength={MAX_LENGTH}
                  editable={!busy}
                  textAlignVertical="top"
                  accessibilityLabel="Post text"
                />
              </View>

              {/* Poll options: 2 to 6, fixed once posted */}
              {type === "poll" && !editing && (
                <View className="gap-2">
                  <Text className="compose__label">Options<Text className="compose__required"> *</Text></Text>
                  {pollOptions.map((option, index) => (
                    <View key={index} className="flex-row items-center gap-2">
                      <TextInput className="compose__input min-w-0 flex-1" value={option} onChangeText={(value) => setPollOptions((current) => current.map((item, i) => (i === index ? value : item)))} maxLength={80} editable={!busy} placeholder={`Option ${index + 1}`} placeholderTextColor={colors.faint} accessibilityLabel={`Option ${index + 1}`} />
                      {pollOptions.length > 2 && (
                        <Pressable onPress={() => setPollOptions((current) => current.filter((_, i) => i !== index))} hitSlop={8} className="compose__remove" accessibilityRole="button" accessibilityLabel={`Remove option ${index + 1}`}>
                          <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={14} tintColor={colors.muted} />
                        </Pressable>
                      )}
                    </View>
                  ))}
                  {pollOptions.length < MAX_POLL_OPTIONS && (
                    <Pressable onPress={() => setPollOptions((current) => [...current, ""])} className="admin__action self-start" accessibilityRole="button" accessibilityLabel="Add option">
                      <Text className="admin__action-label">+ Add option</Text>
                    </Pressable>
                  )}
                </View>
              )}

              {/* Photos (required on a photo post; none on a poll) */}
              {takesPhotos && (
                <View className="gap-2">
                  <View className="flex-row items-center justify-between">
                    <Text className="compose__label">
                      Photos{type === "photo" ? <Text className="compose__required"> *</Text> : null}
                    </Text>
                    {photos.length > 0 && <Text className="home__note">{photos.length}/{MAX_PHOTOS}</Text>}
                  </View>
                  <View className="flex-row items-start gap-3">
                    {photos.length < MAX_PHOTOS && (
                      <Pressable onPress={() => setSheet("photo")} disabled={busy} className="compose__add" accessibilityRole="button" accessibilityLabel="Add photos">
                        <SymbolView name={{ ios: "photo.badge.plus", android: "add_photo_alternate", web: "add_photo_alternate" }} size={24} tintColor={colors.inkSoft} />
                        <Text className="compose__add-label">Add</Text>
                      </Pressable>
                    )}
                    <View className="min-w-0 flex-1">
                      <MediaStrip photos={photos} disabled={busy} onRemove={removePhoto} onMove={movePhoto} />
                    </View>
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
              )}

              {/* Location, tags and audience */}
              <View className="compose__options">
                <Pressable onPress={() => setShowLocation(true)} disabled={busy} className="compose__option" accessibilityRole="button" accessibilityLabel={location.trim() ? `Location: ${location.trim()}` : "Add location"}>
                  <View className="compose__option-icon">
                    <SymbolView name={{ ios: "mappin.and.ellipse", android: "place", web: "place" }} size={18} tintColor={colors.ink} />
                  </View>
                  {showLocation ? (
                    <TextInput className="compose__option-input" value={location} onChangeText={setLocation} maxLength={120} editable={!busy} autoFocus={!location} placeholder="Gym, park or city" placeholderTextColor={colors.faint} accessibilityLabel="Location" />
                  ) : (
                    <Text className="compose__option-title">Add location</Text>
                  )}
                </Pressable>
                <View className="compose__option-divider" />
                <Pressable onPress={() => setSheet("tags")} disabled={busy || editing} className="compose__option" accessibilityRole="button" accessibilityLabel={tagged.length > 0 ? `Tagged: ${tagged.map((m) => m.name).join(", ")}` : "Tag people"}>
                  <View className="compose__option-icon">
                    <SymbolView name={{ ios: "tag", android: "sell", web: "sell" }} size={18} tintColor={colors.ink} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="compose__option-title">Tag people</Text>
                    {tagged.length > 0 && <Text className="compose__option-hint" numberOfLines={1}>with {tagged.map((m) => m.name).join(", ")}</Text>}
                  </View>
                </Pressable>
                <View className="compose__option-divider" />
                {inPlace ? (
                  <View className="compose__option">
                    <View className="compose__option-icon">
                      <SymbolView name={{ ios: "person.3", android: "groups", web: "groups" }} size={18} tintColor={colors.ink} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="compose__option-title">Shared with {placeName}</Text>
                      <Text className="compose__option-hint">Members of the gym see it in its feed.</Text>
                    </View>
                  </View>
                ) : (
                  <Pressable onPress={() => setSheet("audience")} disabled={busy} className="compose__option" accessibilityRole="button" accessibilityLabel={`Audience: ${audienceLabels[audience].label}`}>
                    <View className="compose__option-icon">
                      <SymbolView name={audienceIcons[audience]} size={18} tintColor={colors.ink} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="compose__option-title">Audience: {audienceLabels[audience].label}</Text>
                      <Text className="compose__option-hint">{isPrivate ? "Your account is private, so posts can't be shared with everyone." : audienceLabels[audience].hint}</Text>
                    </View>
                    <SymbolView name={{ ios: "chevron.down", android: "expand_more", web: "expand_more" }} size={16} tintColor={colors.ink} />
                  </Pressable>
                )}
              </View>
              {editing && <Text className="home__note">Tags and poll options can&apos;t be changed after posting.</Text>}

              {error && (
                <Pressable onPress={() => setError(null)} accessibilityLabel="Dismiss error">
                  <FormAlert message={error} />
                </Pressable>
              )}
            </ScrollView>
          )}

          <View className="compose__footer">
            <Pressable onPress={publish} disabled={busy} className="btn-forest flex-1" style={{ opacity: busy ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel={publishLabel}>
              {publishing ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">{publishLabel}</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <ActionSheet
        visible={sheet === "place"}
        title="Posting to"
        actions={[{ label: "My JustFit feed", onPress: () => setPlace({ kind: "feed" }) }, ...postableGyms.map((gym) => ({ label: gym.name, onPress: () => setPlace({ kind: "gym" as const, id: gym.id, name: gym.name }) }))]}
        onClose={() => setSheet(null)}
      />
      <ActionSheet
        visible={sheet === "audience"}
        title="Who can see this post?"
        actions={audiences.map((item) => ({ label: audienceLabels[item].label, onPress: () => setAudience(item) }))}
        onClose={() => setSheet(null)}
      />
      <ActionSheet
        visible={sheet === "photo"}
        title="Add photos"
        actions={[
          { label: "Take photo", onPress: () => addPhotos("camera") },
          { label: "Choose from gallery", onPress: () => addPhotos("library") },
        ]}
        onClose={() => setSheet(null)}
      />
      {sheet === "tags" && (
        <TagPeopleSheet
          visible
          selected={tagged}
          onDone={(members) => {
            setTagged(members);
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </View>
  );
}
