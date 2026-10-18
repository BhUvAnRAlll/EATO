import { apiFetch, type ApiResult } from "@/lib/api";
import type { FriendState } from "@/lib/friends";

// Calls for the community: feed, posts, stories, friends and direct messages. The shapes
// mirror the server's (Eato_server/community/). `token` is the Clerk session token.

export type Member = { id: string; name: string; initial: string };

// A post's type. Create Post offers photo, progress, meal, achievement, question and poll;
// "general" (the feed's quick post) and "workout" come from older posts.
export type PostCategory = "general" | "meal" | "workout" | "progress" | "achievement" | "photo" | "question" | "poll";

// The types Create Post offers, in chip order. "general" (shown as Text) is last, for a post
// that is just words, such as an update in a gym.
export type PostType = "photo" | "progress" | "meal" | "achievement" | "question" | "poll" | "general";
export const postTypes: PostType[] = ["photo", "progress", "meal", "achievement", "question", "poll", "general"];

// A poll's results: live counts, and the viewer's own choice (null until they vote)
export type Poll = { options: { id: string; label: string; votes: number }[]; totalVotes: number; myVote: string | null };

// The details a type carries (null where the type has none)
export type PostDetails = {
  headline: string | null; // progress title, meal name or achievement title
  detail: string | null; // progress milestone or achievement description
  detailDate: string | null; // "YYYY-MM-DD", progress only
  mealKcal: number | null;
  mealProteinG: number | null;
};

// Who may see a post: everyone eligible, accepted followers, or only the author
export type PostAudience = "public" | "followers" | "only_me";

// One photo on a post: url is "/api/media/<id>", fetched with the session token
export type PostMedia = { id: string; url: string };

export type Post = {
  id: string;
  author: Member;
  gymId: string | null;
  // "pending" = held for gym staff (post moderation); only the author and staff see it
  reviewStatus: "published" | "pending";
  category: PostCategory;
  audience: PostAudience;
  body: string;
  headline: string | null;
  detail: string | null;
  detailDate: string | null;
  mealKcal: number | null;
  mealProteinG: number | null;
  location: string | null;
  tagged: Member[]; // friends tagged on the post ("with Sarah Chen")
  poll: Poll | null;
  imageUrl: string | null; // the first photo (cover), or null
  media: PostMedia[]; // every photo, in display order
  likeCount: number;
  commentCount: number;
  liked: boolean;
  isOwn: boolean;
  createdAt: string;
  updatedAt: string;
};

// What Create Post sends. A gym post leaves out the audience (the gym decides who sees it).
export type NewPost = {
  body: string;
  category: PostCategory;
  audience?: PostAudience;
  mediaIds?: string[];
  clientKey?: string;
  location?: string | null;
  taggedUserIds?: string[];
  pollOptions?: string[];
} & Partial<PostDetails>;

export type Comment = { id: string; postId: string; author: Member; body: string; isOwn: boolean; createdAt: string };

// Who sees a story: everyone eligible, accepted followers, or the owner's Close Friends
export type StoryAudience = "public" | "followers" | "close_friends";

export type Story = {
  id: string;
  author: Member;
  imageUrl: string | null;
  caption: string | null;
  audience: StoryAudience;
  viewed: boolean;
  isOwn: boolean;
  viewCount: number | null; // only on the owner's own stories
  createdAt: string;
  expiresAt: string;
};

// One row of the Close Friends screen: a follower, in or out of the list
export type CloseFriend = { member: Member; isCloseFriend: boolean };

// One member's active stories, as the stories row shows them
export type StoryGroup = { member: Member; isOwn: boolean; stories: Story[]; allViewed: boolean };

export type Conversation = { id: string; other: Member; lastMessage: string | null; lastMessageAt: string | null; unreadCount: number };

export type Message = { id: string; conversationId: string; senderId: string; body: string; isOwn: boolean; createdAt: string };

export type Page<K extends string, T> = { [key in K]: T[] } & { nextCursor: string | null };

export type Profile = {
  member: Member;
  bio: string | null;
  isPrivate: boolean;
  isOwn: boolean;
  suspended: boolean;
  followers: number;
  following: number;
  postCount: number;
  followState: "none" | "requested" | "following";
  followsMe: boolean;
  blocked: boolean;
  canViewPosts: boolean;
  friendState: FriendState;
};

export type FollowRequest = { member: Member; requestedAt: string };

// Where a friendship stands, from the viewer's side. Friendship is separate from following:
// it unlocks messaging, never a private account's posts.
export type { FriendState };
export type Friend = { member: Member; since: string };
export type FriendRequest = { member: Member; requestedAt: string };
export type FriendCandidate = { member: Member; friendState: FriendState };
type FriendAnswer = { userId: string; friendState: FriendState };

// A report as the moderation screen shows it (admins only)
export type ReportDetail = {
  id: string;
  reason: string;
  status: "open" | "reviewed" | "dismissed";
  createdAt: string;
  reporter: Member;
  target: { type: "post" | "comment" | "story"; id: string; body: string | null; imageUrl: string | null; deleted: boolean; expired: boolean; author: Member; authorSuspended: boolean };
};

export type SuspendedMember = { member: Member; since: string };

// One entry under the bell. Likes and comments point at a post; trainer entries come from the
// member's trainer; gym entries point at a gym. The server builds the preview line.
export type Activity =
  | { type: "like" | "comment"; member: Member; postId: string; preview: string; at: string }
  | { type: "friend_accepted"; member: Member; preview: string; at: string }
  | { type: "trainer_accepted" | "plan_updated" | "workout_updated" | "recommendation"; member: Member; preview: string; at: string }
  | { type: "gym_approved"; gymId: string; preview: string; at: string }
  | { type: "rsvp"; member: Member; gymId: string; preview: string; at: string };

// Join requests waiting in a gym the viewer owns or administers
export type GymRequestSummary = { gymId: string; gymName: string; waiting: number; latestAt: string };

// The message apiFetch gives when the request never reached the server
export const OFFLINE_MESSAGE = "Couldn't reach the server. Check your connection and try again.";
export const isOffline = (error: string | null) => error === OFFLINE_MESSAGE;

const signedOut = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again." });

const query = (params: Record<string, string | number | null | undefined>) => {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`);
  return parts.length ? `?${parts.join("&")}` : "";
};

export const community = {
  // ---- media ----
  uploadImage(token: string | null, file: { data: string; mediaType: string }): Promise<ApiResult<{ media: { id: string; url: string } }>> {
    if (!token) return signedOut();
    return apiFetch("/api/community/media", { method: "POST", body: file, token });
  },

  // ---- feed and posts ----
  feed(token: string | null, cursor: string | null = null): Promise<ApiResult<Page<"posts", Post>>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/feed${query({ cursor, limit: 20 })}`, { token });
  },
  // clientKey is made once per draft: publishing it twice (a double tap, a retry) saves one post
  createPost(token: string | null, body: NewPost): Promise<ApiResult<{ post: Post }>> {
    if (!token) return signedOut();
    return apiFetch("/api/community/posts", { method: "POST", body, token });
  },
  getPost(token: string | null, postId: string): Promise<ApiResult<{ post: Post }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/posts/${postId}`, { token });
  },
  updatePost(token: string | null, postId: string, changes: { body?: string; category?: PostCategory; audience?: PostAudience; mediaIds?: string[]; location?: string | null } & Partial<PostDetails>): Promise<ApiResult<{ post: Post }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/posts/${postId}`, { method: "PATCH", body: changes, token });
  },
  // One vote per member; voting again moves it. Answers with the post and its new counts.
  vote(token: string | null, postId: string, optionId: string): Promise<ApiResult<{ post: Post }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/posts/${postId}/vote`, { method: "POST", body: { optionId }, token });
  },
  deletePost(token: string | null, postId: string): Promise<ApiResult<{ deleted: true }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/posts/${postId}`, { method: "DELETE", token });
  },
  setLike(token: string | null, postId: string, liked: boolean): Promise<ApiResult<{ liked: boolean; likeCount: number }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/posts/${postId}/like`, { method: liked ? "POST" : "DELETE", token });
  },
  comments(token: string | null, postId: string, cursor: string | null = null): Promise<ApiResult<Page<"comments", Comment>>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/posts/${postId}/comments${query({ cursor, limit: 30 })}`, { token });
  },
  addComment(token: string | null, postId: string, body: string): Promise<ApiResult<{ comment: Comment; commentCount: number }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/posts/${postId}/comments`, { method: "POST", body: { body }, token });
  },
  deleteComment(token: string | null, commentId: string): Promise<ApiResult<{ postId: string; commentCount: number }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/comments/${commentId}`, { method: "DELETE", token });
  },
  report(token: string | null, target: { postId: string } | { commentId: string }, reason: string): Promise<ApiResult<{ reported: true }>> {
    if (!token) return signedOut();
    const path = "postId" in target ? `/api/community/posts/${target.postId}/report` : `/api/community/comments/${target.commentId}/report`;
    return apiFetch(path, { method: "POST", body: { reason }, token });
  },

  // ---- stories ----
  stories(token: string | null): Promise<ApiResult<{ members: StoryGroup[] }>> {
    if (!token) return signedOut();
    return apiFetch("/api/community/stories", { token });
  },
  createStory(token: string | null, body: { mediaId: string; caption?: string | null; audience: StoryAudience }): Promise<ApiResult<{ story: Story }>> {
    if (!token) return signedOut();
    return apiFetch("/api/community/stories", { method: "POST", body, token });
  },
  viewStory(token: string | null, storyId: string): Promise<ApiResult<{ viewed: true }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/stories/${storyId}/view`, { method: "POST", token });
  },
  deleteStory(token: string | null, storyId: string): Promise<ApiResult<{ deleted: true }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/stories/${storyId}`, { method: "DELETE", token });
  },
  reportStory(token: string | null, storyId: string, reason: string): Promise<ApiResult<{ reported: true }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/stories/${storyId}/report`, { method: "POST", body: { reason }, token });
  },
  // The caller's own Close Friends (and the followers they can add); never anyone else's
  closeFriends(token: string | null): Promise<ApiResult<{ members: CloseFriend[] }>> {
    if (!token) return signedOut();
    return apiFetch("/api/community/me/close-friends", { token });
  },
  setCloseFriend(token: string | null, userId: string, isCloseFriend: boolean): Promise<ApiResult<{ userId: string; isCloseFriend: boolean }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/me/close-friends/${encodeURIComponent(userId)}`, { method: isCloseFriend ? "PUT" : "DELETE", token });
  },

  // ---- profiles, following, blocking ----
  me(token: string | null): Promise<ApiResult<{ profile: Profile }>> {
    if (!token) return signedOut();
    return apiFetch("/api/community/me", { token });
  },
  updateMe(token: string | null, changes: { isPrivate?: boolean; bio?: string | null }): Promise<ApiResult<{ profile: Profile }>> {
    if (!token) return signedOut();
    return apiFetch("/api/community/me", { method: "PATCH", body: changes, token });
  },
  profile(token: string | null, userId: string): Promise<ApiResult<{ profile: Profile }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/profiles/${encodeURIComponent(userId)}`, { token });
  },
  profilePosts(token: string | null, userId: string, cursor: string | null = null): Promise<ApiResult<Page<"posts", Post>>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/profiles/${encodeURIComponent(userId)}/posts${query({ cursor, limit: 20 })}`, { token });
  },
  setFollow(token: string | null, userId: string, follow: boolean): Promise<ApiResult<{ profile: Profile }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/profiles/${encodeURIComponent(userId)}/follow`, { method: follow ? "POST" : "DELETE", token });
  },
  setBlock(token: string | null, userId: string, blocked: boolean): Promise<ApiResult<{ blocked: boolean }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/profiles/${encodeURIComponent(userId)}/block`, { method: blocked ? "POST" : "DELETE", token });
  },
  // requestCount (the bell's badge) counts what the viewer can act on: follow, friend and gym join requests
  notifications(token: string | null): Promise<ApiResult<{ followRequests: FollowRequest[]; friendRequests: FriendRequest[]; gymRequests: GymRequestSummary[]; requestCount: number; activity: Activity[] }>> {
    if (!token) return signedOut();
    return apiFetch("/api/community/notifications", { token });
  },
  answerFollowRequest(token: string | null, userId: string, accept: boolean): Promise<ApiResult<{ followerId: string; accepted: boolean }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/me/follow-requests/${encodeURIComponent(userId)}/${accept ? "accept" : "decline"}`, { method: "POST", token });
  },

  // ---- friends (always the caller's own; the server takes the caller from the session) ----
  friends(token: string | null): Promise<ApiResult<{ friends: Friend[] }>> {
    if (!token) return signedOut();
    return apiFetch("/api/community/friends", { token });
  },
  friendRequests(token: string | null): Promise<ApiResult<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }>> {
    if (!token) return signedOut();
    return apiFetch("/api/community/friends/requests", { token });
  },
  // A name search, or suggestions when `search` is empty
  findFriends(token: string | null, search: string | null): Promise<ApiResult<{ members: FriendCandidate[] }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/friends/search${query({ search })}`, { token });
  },
  sendFriendRequest(token: string | null, userId: string): Promise<ApiResult<FriendAnswer>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/friends/${encodeURIComponent(userId)}/request`, { method: "POST", token });
  },
  cancelFriendRequest(token: string | null, userId: string): Promise<ApiResult<FriendAnswer>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/friends/${encodeURIComponent(userId)}/request`, { method: "DELETE", token });
  },
  answerFriendRequest(token: string | null, userId: string, accept: boolean): Promise<ApiResult<FriendAnswer>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/friends/${encodeURIComponent(userId)}/${accept ? "accept" : "decline"}`, { method: "POST", token });
  },
  removeFriend(token: string | null, userId: string): Promise<ApiResult<FriendAnswer>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/friends/${encodeURIComponent(userId)}`, { method: "DELETE", token });
  },

  // ---- messages ----
  conversations(token: string | null): Promise<ApiResult<{ conversations: Conversation[]; unreadCount: number }>> {
    if (!token) return signedOut();
    return apiFetch("/api/community/conversations", { token });
  },
  openConversation(token: string | null, userId: string): Promise<ApiResult<{ conversation: { id: string } }>> {
    if (!token) return signedOut();
    return apiFetch("/api/community/conversations", { method: "POST", body: { userId }, token });
  },
  // canSend is false (with the reason) when the other member isn't a friend; history stays readable
  messages(token: string | null, conversationId: string, cursor: string | null = null): Promise<ApiResult<Page<"messages", Message> & { other: Member | null; canSend: boolean; lockReason: string | null }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/conversations/${conversationId}/messages${query({ cursor, limit: 30 })}`, { token });
  },
  // `id` is a UUID the screen makes for the message, so sending it again after a timeout
  // returns the stored message instead of creating a second one
  sendMessage(token: string | null, conversationId: string, body: string, id?: string): Promise<ApiResult<{ message: Message }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/conversations/${conversationId}/messages`, { method: "POST", body: id ? { id, body } : { body }, token });
  },
};

// Admin-only moderation calls (the server checks the role on every one)
export const adminModeration = {
  openReports(token: string | null): Promise<ApiResult<{ reports: { id: string; postId: string | null; commentId: string | null; storyId: string | null }[] }>> {
    if (!token) return signedOut();
    return apiFetch("/api/community/reports", { token });
  },
  report(token: string | null, reportId: string): Promise<ApiResult<{ report: ReportDetail }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/reports/${reportId}`, { token });
  },
  resolve(token: string | null, reportId: string, status: "reviewed" | "dismissed"): Promise<ApiResult<{ id: string; status: string }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/reports/${reportId}/resolve`, { method: "POST", body: { status }, token });
  },
  deletePost: (token: string | null, postId: string) => community.deletePost(token, postId),
  deleteComment: (token: string | null, commentId: string) => community.deleteComment(token, commentId),
  deleteStory: (token: string | null, storyId: string) => community.deleteStory(token, storyId),
  suspendedMembers(token: string | null): Promise<ApiResult<{ members: SuspendedMember[] }>> {
    if (!token) return signedOut();
    return apiFetch("/api/community/admin/members/suspended", { token });
  },
  setSuspended(token: string | null, userId: string, suspended: boolean): Promise<ApiResult<{ userId: string; suspended: boolean }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/admin/members/${encodeURIComponent(userId)}/suspend`, { method: suspended ? "POST" : "DELETE", token });
  },
};

// "12m ago", "3h ago", "2d ago", or the date for older items
export function timeAgo(iso: string, now = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export const categoryLabels: Record<PostCategory, string> = {
  general: "General",
  meal: "Meal",
  workout: "Workout",
  progress: "Progress",
  achievement: "Achievement",
  photo: "Photo",
  question: "Question",
  poll: "Poll",
};

export const audienceLabels: Record<PostAudience, { label: string; hint: string }> = {
  public: { label: "Everyone", hint: "Anyone on EATO" },
  followers: { label: "Followers", hint: "Members you've accepted as followers" },
  only_me: { label: "Only me", hint: "Just you" },
};

export const storyAudienceLabels: Record<StoryAudience, { label: string; hint: string }> = {
  public: { label: "Everyone", hint: "Anyone on EATO, for 24 hours" },
  followers: { label: "Followers", hint: "Members you've accepted as followers" },
  close_friends: { label: "Close Friends", hint: "Only the people on your Close Friends list" },
};

// The story audiences an account may use: a private account can't address everyone (the
// server applies the same rule when the story is saved)
export const storyAudiencesFor = (isPrivate: boolean): StoryAudience[] => (isPrivate ? ["followers", "close_friends"] : ["public", "followers", "close_friends"]);

// The audiences an account may publish to: a private account can't address everyone
// (the server applies the same rule when the post is saved)
export const audiencesFor = (isPrivate: boolean): PostAudience[] => (isPrivate ? ["followers", "only_me"] : ["public", "followers", "only_me"]);
