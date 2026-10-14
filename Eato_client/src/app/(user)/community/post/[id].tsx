import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { ActionSheet, type SheetAction } from "@/components/community/ActionSheet";
import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { PostCard } from "@/components/community/PostCard";
import { FormAlert } from "@/components/FormAlert";
import { community, timeAgo, type Comment, type Post } from "@/lib/community";
import { useSessionToken } from "@/lib/session";
import { useCommunityStore } from "@/store/community";
import { colors } from "@/theme";

const MAX_LENGTH = 500;

// One post with its comments (paged, oldest first) and a reply box
export default function PostComments() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const getToken = useSessionToken();
  const store = useCommunityStore();
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [menuComment, setMenuComment] = useState<Comment | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    const token = await getToken();
    const [postResult, commentsResult] = await Promise.all([community.getPost(token, id), community.comments(token, id)]);
    if (!postResult.ok || !commentsResult.ok) {
      setError(postResult.ok ? (commentsResult.ok ? null : commentsResult.error) : postResult.error);
      setStatus("error");
      return;
    }
    setPost(postResult.data.post);
    setComments(commentsResult.data.comments);
    setCursor(commentsResult.data.nextCursor);
    setError(null);
    setStatus("ready");
  }, [id, getToken]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const loadMore = async () => {
    if (!cursor) return;
    const result = await community.comments(await getToken(), id, cursor);
    if (result.ok) {
      setComments((current) => [...current, ...result.data.comments.filter((c) => !current.some((item) => item.id === c.id))]);
      setCursor(result.data.nextCursor);
    }
  };

  const like = async () => {
    if (!post) return;
    const liked = !post.liked;
    setPost({ ...post, liked, likeCount: Math.max(0, post.likeCount + (liked ? 1 : -1)) });
    const result = await community.setLike(await getToken(), post.id, liked);
    if (!result.ok) {
      setPost(post);
      setError(result.error);
      return;
    }
    setPost((current) => (current ? { ...current, ...result.data } : current));
    store.patchPost(post.id, result.data);
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const result = await community.addComment(await getToken(), id, body);
    setSending(false);
    if (!result.ok) return setError(result.error);
    setText("");
    setComments((current) => [...current, result.data.comment]);
    setPost((current) => (current ? { ...current, commentCount: result.data.commentCount } : current));
    store.patchPost(id, { commentCount: result.data.commentCount });
  };

  const commentActions = (comment: Comment): SheetAction[] => {
    const actions: SheetAction[] = [];
    if (comment.isOwn || post?.isOwn) {
      actions.push({
        label: "Delete comment",
        destructive: true,
        onPress: async () => {
          const result = await community.deleteComment(await getToken(), comment.id);
          if (!result.ok) return setError(result.error);
          setComments((current) => current.filter((item) => item.id !== comment.id));
          setPost((current) => (current ? { ...current, commentCount: result.data.commentCount } : current));
          store.patchPost(id, { commentCount: result.data.commentCount });
        },
      });
    }
    if (!comment.isOwn) {
      actions.push({
        label: "Report comment",
        destructive: true,
        onPress: async () => {
          const result = await community.report(await getToken(), { commentId: comment.id }, "Reported from the comments");
          setError(result.ok ? "Thanks, we'll review this comment." : result.error);
        },
      });
    }
    return actions;
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="h-12 flex-row items-center px-5">
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
          </Pressable>
          <Text className="type-subhead ml-3 flex-1 text-forest-ink">Comments</Text>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          {status === "loading" && !post ? (
            <ActivityIndicator color={colors.forest} className="mt-6" />
          ) : status === "error" && !post ? (
            <View className="px-5 pt-4">
              <EmptyState icon={{ ios: "wifi.exclamationmark", android: "wifi_off", web: "wifi_off" }} title="Couldn't load the post" text={error ?? "Please try again."} actionLabel="Retry" onAction={load} />
            </View>
          ) : (
            <FlatList
              data={comments}
              keyExtractor={(comment) => comment.id}
              ListHeaderComponent={
                post ? (
                  <View className="px-5 pb-4">
                    <PostCard post={post} width={width - 40} onLike={like} onOpenComments={() => {}} onMenu={() => {}} onAuthor={() => router.push({ pathname: "/community/profile/[userId]", params: { userId: post.author.id } })} />
                    {error && (
                      <Pressable onPress={() => setError(null)} className="mt-3">
                        <FormAlert message={error} />
                      </Pressable>
                    )}
                    <Text className="setup__section mt-4">{post.commentCount === 1 ? "1 comment" : `${post.commentCount} comments`}</Text>
                  </View>
                ) : null
              }
              ListEmptyComponent={<Text className="home__note px-5">No comments yet. Say something kind.</Text>}
              ListFooterComponent={cursor ? (
                <Pressable onPress={loadMore} className="admin__action mx-5 my-3 self-start" accessibilityRole="button">
                  <Text className="admin__action-label">Load more comments</Text>
                </Pressable>
              ) : <View className="h-3" />}
              renderItem={({ item }) => (
                <View className="flex-row gap-3 px-5 py-2">
                  <Avatar member={item.author} size={36} />
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2">
                      <Text className="post__author" style={{ fontSize: 14 }}>{item.author.name}</Text>
                      <Text className="post__time">{timeAgo(item.createdAt)}</Text>
                      <View className="flex-1" />
                      <Pressable onPress={() => setMenuComment(item)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Comment options">
                        <SymbolView name={{ ios: "ellipsis", android: "more_horiz", web: "more_horiz" }} size={16} tintColor={colors.muted} />
                      </Pressable>
                    </View>
                    <Text className="comment__body mt-0.5">{item.body}</Text>
                  </View>
                </View>
              )}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            />
          )}

          <View className="flex-row items-end gap-2 border-t border-cream-line bg-cream px-5 py-3">
            <TextInput className="reply" value={text} onChangeText={setText} placeholder="Write a comment" placeholderTextColor={colors.faint} multiline maxLength={MAX_LENGTH} accessibilityLabel="Write a comment" />
            <Pressable onPress={send} disabled={!text.trim() || sending} className="reply__send" style={{ opacity: text.trim() && !sending ? 1 : 0.5 }} accessibilityRole="button" accessibilityLabel="Send comment">
              {sending ? <ActivityIndicator color={colors.white} /> : <SymbolView name={{ ios: "arrow.up", android: "arrow_upward", web: "arrow_upward" }} size={20} tintColor={colors.white} />}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <ActionSheet visible={menuComment !== null} actions={menuComment ? commentActions(menuComment) : []} onClose={() => setMenuComment(null)} />
    </View>
  );
}
