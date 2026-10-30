import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, useWindowDimensions, View, type TextInputInstance } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { ActionSheet, type SheetAction } from "@/components/community/ActionSheet";
import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { PostCard } from "@/components/community/PostCard";
import { PostMenu } from "@/components/community/PostMenu";
import { FormAlert } from "@/components/FormAlert";
import { community, timeAgo, type Comment, type Post } from "@/lib/community";
import { useMe } from "@/lib/me";
import { useSessionToken } from "@/lib/session";
import { useCommunityStore } from "@/store/community";
import { colors } from "@/theme";
import { track } from "@/lib/analytics";

const MAX_LENGTH = 500;

// One post with its comments (paged, oldest first) and a comment box. A long press on a
// comment opens its options (Delete or Report).
export default function PostComments() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const getToken = useSessionToken();
  const me = useMe();
  const store = useCommunityStore();
  const input = useRef<TextInputInstance>(null);
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [menuComment, setMenuComment] = useState<Comment | null>(null);
  const [menuPost, setMenuPost] = useState<Post | null>(null);

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

  const vote = async (optionId: string) => {
    if (!post) return;
    const result = await community.vote(await getToken(), post.id, optionId);
    if (!result.ok) return setError(result.error);
    setPost(result.data.post);
    store.upsertPost(result.data.post);
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const result = await community.addComment(await getToken(), id, body);
    if (result.ok) track("community_comment_sent");
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
        <View className="screen-bar">
          <Pressable onPress={() => router.back()} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title">Post</Text>
          <View className="screen-bar__spacer" />
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
                  <View className="px-5 pb-3 pt-4">
                    <PostCard post={post} width={width - 32} onLike={like} onOpenComments={() => input.current?.focus()} onMenu={() => setMenuPost(post)} onVote={vote} onAuthor={() => router.push({ pathname: "/community/profile/[userId]", params: { userId: post.author.id } })} />
                    {error && (
                      <Pressable onPress={() => setError(null)} className="mt-3">
                        <FormAlert message={error} />
                      </Pressable>
                    )}
                    <Text className="comments__heading mt-6">Comments ({post.commentCount})</Text>
                  </View>
                ) : undefined
              }
              ListEmptyComponent={<Text className="home__note px-5">No comments yet. Say something kind.</Text>}
              ListFooterComponent={cursor ? (
                <Pressable onPress={loadMore} className="admin__action mx-5 my-3 self-start" accessibilityRole="button">
                  <Text className="admin__action-label">Load more comments</Text>
                </Pressable>
              ) : <View className="h-3" />}
              renderItem={({ item }) => (
                <View className="flex-row gap-3 px-5 py-1.5">
                  <Avatar member={item.author} size={34} />
                  <Pressable
                    onLongPress={() => setMenuComment(item)}
                    delayLongPress={350}
                    className="comment__bubble"
                    accessibilityLabel={`${item.author.name}: ${item.body}`}
                    accessibilityHint="Long press for options"
                    accessibilityActions={[{ name: "longpress", label: "Comment options" }]}
                    onAccessibilityAction={() => setMenuComment(item)}
                  >
                    <Text className="comment__meta" numberOfLines={1}>
                      <Text className="comment__author">{item.author.name}</Text> · {timeAgo(item.createdAt)}
                    </Text>
                    <Text className="comment__body mt-0.5">{item.body}</Text>
                  </Pressable>
                </View>
              )}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            />
          )}

          <View className="comment-bar">
            <Avatar member={me} size={34} />
            <TextInput ref={input} className="comment-bar__input" value={text} onChangeText={setText} placeholder="Add a comment..." placeholderTextColor={colors.faint} multiline numberOfLines={1} maxLength={MAX_LENGTH} accessibilityLabel="Add a comment" />
            <Pressable onPress={send} disabled={!text.trim() || sending} className={text.trim() && !sending ? "comment-bar__send" : "comment-bar__send comment-bar__send--disabled"} accessibilityRole="button" accessibilityLabel="Send comment" accessibilityState={{ disabled: !text.trim() || sending, busy: sending }}>
              {sending ? <ActivityIndicator color={colors.white} /> : <SymbolView name={{ ios: "paperplane.fill", android: "send", web: "send" }} size={18} tintColor={colors.white} />}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <ActionSheet visible={menuComment !== null} actions={menuComment ? commentActions(menuComment) : []} onClose={() => setMenuComment(null)} />
      <PostMenu
        post={menuPost}
        source="the post screen"
        onClose={() => setMenuPost(null)}
        onDeleted={(deleted) => {
          store.removePost(deleted.id);
          router.back();
        }}
        onNotice={setError}
      />
    </View>
  );
}
