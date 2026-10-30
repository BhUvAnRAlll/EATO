import { useState } from "react";
import { Pressable, ScrollView, Share, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { SymbolView } from "@/components/SymbolView";

import { AuthImage } from "@/components/community/AuthImage";
import { Avatar } from "@/components/community/Avatar";
import { categoryLabels, timeAgo, type Poll, type Post, type PostMedia } from "@/lib/community";
import { colors } from "@/theme";

type PostCardProps = {
  post: Post;
  width: number;
  onLike: () => void;
  onOpenComments: () => void;
  onMenu: () => void;
  // Open the author's profile
  onAuthor?: () => void;
  // Vote on a poll (without it the poll shows its results only)
  onVote?: (optionId: string) => void;
  // A tag beside the author's name, e.g. "Owner" in a gym feed
  badge?: string | null;
};

const audienceIcons = {
  public: { ios: "globe", android: "public", web: "public" },
  followers: { ios: "person.2", android: "group", web: "group" },
  only_me: { ios: "lock", android: "lock", web: "lock" },
} as const;

const audienceLabels: Record<Post["audience"], string> = {
  public: "Public",
  followers: "Followers only",
  only_me: "Only you can see this",
};

const categoryTags: Record<Post["category"], { label: string; className: string }> = {
  general: { label: "", className: "" },
  meal: { label: "MEAL", className: "post__tag post__tag--meal" },
  workout: { label: "WORKOUT", className: "post__tag post__tag--workout" },
  progress: { label: "PROGRESS", className: "post__tag post__tag--progress" },
  achievement: { label: "PR", className: "post__tag post__tag--achievement" },
  photo: { label: "", className: "" },
  question: { label: "QUESTION", className: "post__tag post__tag--progress" },
  poll: { label: "POLL", className: "post__tag post__tag--progress" },
};

// The box a progress, meal or achievement post leads with (older posts without a title show
// the small tag instead)
const detailBoxes = {
  progress: { kicker: "Progress update", icon: { ios: "chart.line.uptrend.xyaxis", android: "trending_up", web: "trending_up" } },
  meal: { kicker: "Meal", icon: { ios: "fork.knife", android: "restaurant", web: "restaurant" } },
  achievement: { kicker: "Achievement", icon: { ios: "trophy", android: "emoji_events", web: "emoji_events" } },
} as const;

// "1 Oct 2026" from "2026-10-01" (read as a calendar date, not shifted by the time zone)
function calendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function DetailBox({ post }: { post: Post }) {
  if (post.category !== "progress" && post.category !== "meal" && post.category !== "achievement") return null;
  if (!post.headline) return null;
  const box = detailBoxes[post.category];
  const sub =
    post.category === "meal"
      ? [post.mealKcal !== null ? `${post.mealKcal} kcal` : null, post.mealProteinG !== null ? `${post.mealProteinG} g protein` : null].filter(Boolean).join(" · ")
      : [post.detail, post.detailDate ? calendarDate(post.detailDate) : null].filter(Boolean).join(" · ");
  return (
    <View className="post__details mt-3">
      <View className="post__details-icon">
        <SymbolView name={box.icon} size={18} tintColor={colors.ink} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="post__details-kicker">{box.kicker}</Text>
        <Text className="post__details-title">{post.headline}</Text>
        {sub !== "" && <Text className="post__details-sub">{sub}</Text>}
      </View>
    </View>
  );
}

// A poll's options: tap one to vote (or move your vote). Each row fills to its share of votes.
function PollOptions({ poll, onVote }: { poll: Poll; onVote?: (optionId: string) => void }) {
  return (
    <View className="mt-3 gap-2">
      {poll.options.map((option) => {
        const share = poll.totalVotes > 0 ? Math.round((option.votes / poll.totalVotes) * 100) : 0;
        const mine = poll.myVote === option.id;
        return (
          <Pressable
            key={option.id}
            onPress={onVote ? () => onVote(option.id) : undefined}
            disabled={!onVote || mine}
            className={mine ? "poll__option poll__option--mine" : "poll__option"}
            accessibilityRole={onVote ? "radio" : undefined}
            accessibilityState={{ selected: mine }}
            accessibilityLabel={`${option.label}, ${share}%${mine ? ", your vote" : ""}`}
          >
            <View className="poll__fill" style={{ width: `${share}%` }} />
            <Text className="poll__label" numberOfLines={2}>{option.label}</Text>
            <Text className="poll__share">{share}%</Text>
          </Pressable>
        );
      })}
      <Text className="post__time">{poll.totalVotes === 1 ? "1 vote" : `${poll.totalVotes} votes`}</Text>
    </View>
  );
}

// The photos on a post: one fills the card; several swipe sideways with a "1/3" counter
function PostPhotos({ media, width, author }: { media: PostMedia[]; width: number; author: string }) {
  const [index, setIndex] = useState(0);
  const height = Math.round(width * 0.85);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => setIndex(Math.round(event.nativeEvent.contentOffset.x / width));

  if (media.length === 1) {
    return <AuthImage path={media[0].url} style={{ width, height, marginTop: 12 }} accessibilityLabel={`Photo by ${author}`} />;
  }
  return (
    <View style={{ width, height, marginTop: 12 }}>
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

// A feed post: author, time and audience, optional category tag, text, edge-to-edge photos,
// then like, comment and share on the left
export function PostCard({ post, width, onLike, onOpenComments, onMenu, onAuthor, onVote, badge = null }: PostCardProps) {
  const hasBox = Boolean(post.headline) && (post.category === "progress" || post.category === "meal" || post.category === "achievement");
  const tag = hasBox ? { label: "", className: "" } : categoryTags[post.category];
  const share = () => Share.share({ message: `${post.author.name} on justFit: ${post.body}` }).catch(() => {});

  return (
    <View className="post__card">
      <View className="flex-row items-center gap-3">
        <Pressable onPress={onAuthor} disabled={!onAuthor} accessibilityRole={onAuthor ? "button" : undefined}>
          <Avatar member={post.author} />
        </Pressable>
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Text className="post__author flex-shrink" numberOfLines={1}>
              {post.author.name}
            </Text>
            {badge && (
              <View className="gym-badge gym-badge--member" style={{ height: 22 }}>
                <Text className="gym-badge__label" style={{ fontSize: 12 }}>{badge}</Text>
              </View>
            )}
          </View>
          <View className="flex-row items-center gap-1.5">
            <Text className="post__time">{timeAgo(post.createdAt)}</Text>
            {/* Group and gym posts are shown to members, so their audience setting doesn't apply */}
            {!post.gymId && (
              <>
                <Text className="post__time">·</Text>
                <SymbolView name={audienceIcons[post.audience]} size={12} tintColor={colors.faint} accessibilityLabel={audienceLabels[post.audience]} />
              </>
            )}
          </View>
        </View>
        <Pressable onPress={onMenu} hitSlop={8} className="h-8 w-8 items-center justify-center" accessibilityRole="button" accessibilityLabel="Post options">
          <SymbolView name={{ ios: "ellipsis", android: "more_horiz", web: "more_horiz" }} size={20} tintColor={colors.ink} />
        </Pressable>
      </View>

      {tag.label !== "" && (
        <View className={`${tag.className} mt-3 self-start`}>
          <Text className="post__tag-label">{tag.label}</Text>
        </View>
      )}

      <DetailBox post={post} />

      {post.body !== "" && <Text className="post__body mt-3">{post.body}</Text>}

      {post.poll && <PollOptions poll={post.poll} onVote={onVote} />}

      {post.location && (
        <View className="mt-2 flex-row items-center gap-1">
          <SymbolView name={{ ios: "mappin.and.ellipse", android: "place", web: "place" }} size={13} tintColor={colors.muted} />
          <Text className="post__time" numberOfLines={1}>{post.location}</Text>
        </View>
      )}

      {post.tagged.length > 0 && (
        <Text className="post__with mt-1.5" numberOfLines={2}>
          with <Text className="post__with-name">{post.tagged.map((member) => member.name).join(", ")}</Text>
        </Text>
      )}

      {/* Photos span the card edge to edge: -mx-4 undoes the card's 16px padding, and the
          card's 1px border on each side is taken off the width */}
      {post.media.length > 0 && (
        <View className="-mx-4">
          <PostPhotos media={post.media} width={width - 2} author={post.author.name} />
        </View>
      )}

      <View className="mt-3.5 flex-row items-center gap-6">
        <Pressable onPress={onLike} className="flex-row items-center gap-1.5" hitSlop={6} accessibilityRole="button" accessibilityLabel={post.liked ? "Unlike" : "Like"} accessibilityState={{ selected: post.liked }}>
          <SymbolView name={post.liked ? { ios: "heart.fill", android: "favorite", web: "favorite" } : { ios: "heart", android: "favorite_border", web: "favorite_border" }} size={22} tintColor={post.liked ? colors.danger : colors.ink} />
          <Text className="post__count">{post.likeCount}</Text>
        </Pressable>
        <Pressable onPress={onOpenComments} className="flex-row items-center gap-1.5" hitSlop={6} accessibilityRole="button" accessibilityLabel={`${post.commentCount} comments`}>
          <SymbolView name={{ ios: "bubble.right", android: "chat_bubble_outline", web: "chat_bubble_outline" }} size={22} tintColor={colors.ink} />
          <Text className="post__count">{post.commentCount}</Text>
        </Pressable>
        <Pressable onPress={share} hitSlop={6} accessibilityRole="button" accessibilityLabel="Share">
          <SymbolView name={{ ios: "paperplane", android: "send", web: "send" }} size={22} tintColor={colors.ink} />
        </Pressable>
      </View>
    </View>
  );
}

export { categoryLabels };
