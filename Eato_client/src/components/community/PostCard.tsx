import { useState } from "react";
import { Pressable, ScrollView, Share, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { SymbolView } from "expo-symbols";

import { AuthImage } from "@/components/community/AuthImage";
import { Avatar } from "@/components/community/Avatar";
import { categoryLabels, timeAgo, type Post, type PostMedia } from "@/lib/community";
import { colors } from "@/theme";

type PostCardProps = {
  post: Post;
  width: number;
  onLike: () => void;
  onOpenComments: () => void;
  onMenu: () => void;
  // Open the author's profile
  onAuthor?: () => void;
};

const audienceIcons = {
  followers: { ios: "person.2", android: "group", web: "group" },
  only_me: { ios: "lock", android: "lock", web: "lock" },
} as const;

const categoryTags: Record<Post["category"], { label: string; className: string }> = {
  general: { label: "", className: "" },
  meal: { label: "MEAL", className: "post__tag post__tag--meal" },
  workout: { label: "WORKOUT", className: "post__tag post__tag--workout" },
  progress: { label: "PROGRESS", className: "post__tag post__tag--progress" },
  achievement: { label: "PR", className: "post__tag post__tag--achievement" },
};

// The photos on a post: one fills the card; several swipe sideways with a "1/3" counter
function PostPhotos({ media, width, author }: { media: PostMedia[]; width: number; author: string }) {
  const [index, setIndex] = useState(0);
  const height = Math.round(width * 0.66);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => setIndex(Math.round(event.nativeEvent.contentOffset.x / width));

  if (media.length === 1) {
    return <AuthImage path={media[0].url} style={{ width, height, borderRadius: 14, marginTop: 12 }} accessibilityLabel={`Photo by ${author}`} />;
  }
  return (
    <View style={{ width, height, marginTop: 12, borderRadius: 14, overflow: "hidden" }}>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={32} accessibilityLabel={`${media.length} photos by ${author}`}>
        {media.map((item, position) => (
          <AuthImage key={item.id} path={item.url} style={{ width, height }} accessibilityLabel={`Photo ${position + 1} of ${media.length} by ${author}`} />
        ))}
      </ScrollView>
      <View className="post__media-count" pointerEvents="none">
        <Text className="post__media-count-label">
          {Math.min(index, media.length - 1) + 1}/{media.length}
        </Text>
      </View>
    </View>
  );
}

// A feed post: author, time, optional category tag, text, photos, actions
export function PostCard({ post, width, onLike, onOpenComments, onMenu, onAuthor }: PostCardProps) {
  const tag = categoryTags[post.category];
  const share = () => Share.share({ message: `${post.author.name} on EATO: ${post.body}` }).catch(() => {});

  return (
    <View className="post__card">
      <View className="flex-row items-center gap-3">
        <Pressable onPress={onAuthor} disabled={!onAuthor} accessibilityRole={onAuthor ? "button" : undefined}>
          <Avatar member={post.author} />
        </Pressable>
        <View className="flex-1">
          <Text className="post__author" numberOfLines={1}>
            {post.author.name}
          </Text>
          <View className="flex-row items-center gap-1.5">
            <Text className="post__time">{timeAgo(post.createdAt)}</Text>
            {post.audience !== "public" && !post.groupId && (
              <SymbolView name={audienceIcons[post.audience]} size={12} tintColor={colors.faint} accessibilityLabel={post.audience === "only_me" ? "Only you can see this" : "Followers only"} />
            )}
          </View>
        </View>
        {tag.label !== "" && (
          <View className={tag.className}>
            <Text className="post__tag-label">{tag.label}</Text>
          </View>
        )}
        <Pressable onPress={onMenu} hitSlop={8} className="h-8 w-8 items-center justify-center" accessibilityRole="button" accessibilityLabel="Post options">
          <SymbolView name={{ ios: "ellipsis", android: "more_horiz", web: "more_horiz" }} size={18} tintColor={colors.muted} />
        </Pressable>
      </View>

      <Text className="post__body mt-3">{post.body}</Text>

      {post.media.length > 0 && <PostPhotos media={post.media} width={width - 32} author={post.author.name} />}

      <View className="mt-3 flex-row items-center gap-5">
        <Pressable onPress={onLike} className="flex-row items-center gap-1.5" hitSlop={6} accessibilityRole="button" accessibilityLabel={post.liked ? "Unlike" : "Like"} accessibilityState={{ selected: post.liked }}>
          <SymbolView name={post.liked ? { ios: "heart.fill", android: "favorite", web: "favorite" } : { ios: "heart", android: "favorite_border", web: "favorite_border" }} size={20} tintColor={post.liked ? colors.danger : colors.inkSoft} />
          <Text className="post__count">{post.likeCount}</Text>
        </Pressable>
        <Pressable onPress={onOpenComments} className="flex-row items-center gap-1.5" hitSlop={6} accessibilityRole="button" accessibilityLabel={`${post.commentCount} comments`}>
          <SymbolView name={{ ios: "bubble.right", android: "chat_bubble_outline", web: "chat_bubble_outline" }} size={20} tintColor={colors.inkSoft} />
          <Text className="post__count">{post.commentCount}</Text>
        </Pressable>
        <View className="flex-1" />
        <Pressable onPress={share} hitSlop={6} accessibilityRole="button" accessibilityLabel="Share">
          <SymbolView name={{ ios: "square.and.arrow.up", android: "share", web: "share" }} size={20} tintColor={colors.inkSoft} />
        </Pressable>
      </View>
    </View>
  );
}

export { categoryLabels };
