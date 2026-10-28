import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, Pressable, Text, TextInput, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";
import * as Crypto from "expo-crypto";
import { router, useFocusEffect } from "expo-router";

import { ActionSheet } from "@/components/community/ActionSheet";
import { Avatar } from "@/components/community/Avatar";
import { audienceLabels, audiencesFor, community, type Member, type PostAudience } from "@/lib/community";
import { useCommunityStore } from "@/store/community";
import { colors } from "@/theme";

const MAX_LENGTH = 1000;

const audienceIcons = {
  public: { ios: "globe", android: "public", web: "public" },
  followers: { ios: "person.2", android: "group", web: "group" },
  only_me: { ios: "lock", android: "lock", web: "lock" },
} as const;

type QuickPostComposerProps = {
  me: Member;
  getToken: () => Promise<string | null>;
  // One friendly line when posting fails (the feed shows it above the stories)
  onError: (message: string) => void;
};

// The feed's quick post: type a caption, pick who sees it, Post. The photo and ⊞ buttons
// open the full Create Post screen for photos and post types. The new post goes to the top
// of the feed through the store.
export function QuickPostComposer({ me, getToken, onError }: QuickPostComposerProps) {
  const upsertPost = useCommunityStore((state) => state.upsertPost);
  // A fresh key per post, so a retried request can't publish the same post twice
  const clientKey = useRef(Crypto.randomUUID());
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<PostAudience>("public");
  const [isPrivate, setIsPrivate] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [posting, setPosting] = useState(false);

  // A private account can't post to everyone, so its audience starts at Followers. Checked each
  // time the feed is shown, so going private on the profile screen is picked up here.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const result = await community.me(await getToken());
        if (cancelled || !result.ok) return;
        setIsPrivate(result.data.profile.isPrivate);
        if (result.data.profile.isPrivate) setAudience((current) => (current === "public" ? "followers" : current));
      })();
      return () => {
        cancelled = true;
      };
    }, [getToken]),
  );

  const text = body.trim();
  const canPost = text.length > 0 && !posting;

  const post = async () => {
    if (!canPost) return;
    setPosting(true);
    const result = await community.createPost(await getToken(), { body: text, category: "general", audience, clientKey: clientKey.current });
    setPosting(false);
    if (!result.ok) {
      // The account went private since this screen loaded: the server refuses "public"
      if (result.status === 409) {
        setIsPrivate(true);
        setAudience("followers");
      }
      return onError(result.error);
    }
    upsertPost(result.data.post);
    setBody("");
    clientKey.current = Crypto.randomUUID();
    Keyboard.dismiss();
  };

  const openCreatePost = () => router.push("/community/compose");

  return (
    <View className="quick-post">
      <View className="flex-row items-center gap-3">
        <Avatar member={me} size={40} />
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="Share your progress..."
          placeholderTextColor={colors.faint}
          multiline
          maxLength={MAX_LENGTH}
          editable={!posting}
          accessibilityLabel="Share your progress"
          style={{ flex: 1, minWidth: 0, minHeight: 40, maxHeight: 120, paddingVertical: 8, fontSize: 16, lineHeight: 21, color: colors.ink }}
        />
      </View>

      <View className="quick-post__divider" />

      <View className="flex-row items-center gap-1">
        <Pressable onPress={openCreatePost} className="quick-post__tool" accessibilityRole="button" accessibilityLabel="Add photos">
          <SymbolView name={{ ios: "photo", android: "image", web: "image" }} size={22} tintColor={colors.ink} />
        </Pressable>
        <Pressable onPress={openCreatePost} className="quick-post__tool" accessibilityRole="button" accessibilityLabel="Create post">
          <SymbolView name={{ ios: "plus.square", android: "add_box", web: "add_box" }} size={22} tintColor={colors.ink} />
        </Pressable>
        <Pressable onPress={() => setChoosing(true)} disabled={posting} className="quick-post__audience ml-1" accessibilityRole="button" accessibilityLabel={`Audience: ${audienceLabels[audience].label}`}>
          <SymbolView name={audienceIcons[audience]} size={15} tintColor={colors.ink} />
          <Text className="quick-post__audience-label" numberOfLines={1}>{audienceLabels[audience].label}</Text>
          <SymbolView name={{ ios: "chevron.down", android: "expand_more", web: "expand_more" }} size={12} tintColor={colors.ink} />
        </Pressable>
        <View className="min-w-0 flex-1" />
        <Pressable onPress={post} disabled={!canPost} className={canPost ? "quick-post__submit" : "quick-post__submit quick-post__submit--disabled"} accessibilityRole="button" accessibilityLabel="Post" accessibilityState={{ disabled: !canPost, busy: posting }}>
          {posting ? <ActivityIndicator size="small" color={colors.white} /> : <Text className="quick-post__submit-label">Post</Text>}
        </Pressable>
      </View>

      <ActionSheet
        visible={choosing}
        title="Who can see this post?"
        actions={audiencesFor(isPrivate).map((item) => ({ label: audienceLabels[item].label, onPress: () => setAudience(item) }))}
        onClose={() => setChoosing(false)}
      />
    </View>
  );
}
