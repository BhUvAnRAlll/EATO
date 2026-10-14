import { apiFetch, type ApiResult } from "@/lib/api";

// Calls for the community: feed, posts, stories, groups and direct messages. The shapes
// mirror the server's (Eato_server/community/). `token` is the Clerk session token.

export type Member = { id: string; name: string; initial: string };

export type PostCategory = "general" | "meal" | "workout" | "progress" | "achievement";

// Who may see a post: everyone eligible, accepted followers, or only the author
export type PostAudience = "public" | "followers" | "only_me";

// One photo on a post: url is "/api/media/<id>", fetched with the session token
export type PostMedia = { id: string; url: string };

export type Post = {
  id: string;
  author: Member;
  groupId: string | null;
  category: PostCategory;
  audience: PostAudience;
  body: string;
  imageUrl: string | null; // the first photo (cover), or null
  media: PostMedia[]; // every photo, in display order
  likeCount: number;
  commentCount: number;
  liked: boolean;
  isOwn: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Comment = { id: string; postId: string; author: Member; body: string; isOwn: boolean; createdAt: string };

export type Story = { id: string; author: Member; imageUrl: string | null; caption: string | null; viewed: boolean; isOwn: boolean; createdAt: string; expiresAt: string };

// One member's active stories, as the stories row shows them
export type StoryGroup = { member: Member; isOwn: boolean; stories: Story[]; allViewed: boolean };

export type Group = {
  id: string;
  slug: string;
  name: string;
  topic: string;
  description: string;
  coverUrl: string | null;
  isPrivate: boolean;
  memberCount: number;
  joined: boolean;
  createdAt: string;
};

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
};

export type FollowRequest = { member: Member; requestedAt: string };

// A report as the moderation screen shows it (admins only)
export type ReportDetail = {
  id: string;
  reason: string;
  status: "open" | "reviewed" | "dismissed";
  createdAt: string;
  reporter: Member;
  target: { type: "post" | "comment"; id: string; body: string | null; imageUrl: string | null; deleted: boolean; author: Member; authorSuspended: boolean };
};

export type SuspendedMember = { member: Member; since: string };

export type Activity = { type: "like" | "comment"; member: Member; postId: string; preview: string; at: string };

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
  createPost(token: string | null, body: { body: string; category: PostCategory; audience?: PostAudience; mediaIds?: string[]; groupId?: string | null; clientKey?: string }): Promise<ApiResult<{ post: Post }>> {
    if (!token) return signedOut();
    return apiFetch("/api/community/posts", { method: "POST", body, token });
  },
  getPost(token: string | null, postId: string): Promise<ApiResult<{ post: Post }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/posts/${postId}`, { token });
  },
  updatePost(token: string | null, postId: string, changes: { body?: string; category?: PostCategory; audience?: PostAudience; mediaIds?: string[] }): Promise<ApiResult<{ post: Post }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/posts/${postId}`, { method: "PATCH", body: changes, token });
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
  createStory(token: string | null, body: { mediaId: string; caption?: string | null }): Promise<ApiResult<{ story: Story }>> {
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

  // ---- groups ----
  groups(token: string | null, search: string | null = null, cursor: string | null = null): Promise<ApiResult<Page<"groups", Group>>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/groups${query({ search, cursor, limit: 30 })}`, { token });
  },
  getGroup(token: string | null, groupId: string): Promise<ApiResult<{ group: Group }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/groups/${groupId}`, { token });
  },
  groupPosts(token: string | null, groupId: string, cursor: string | null = null): Promise<ApiResult<Page<"posts", Post>>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/groups/${groupId}/posts${query({ cursor, limit: 20 })}`, { token });
  },
  setMembership(token: string | null, groupId: string, joined: boolean): Promise<ApiResult<{ group: Group }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/groups/${groupId}/join`, { method: joined ? "POST" : "DELETE", token });
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
  notifications(token: string | null): Promise<ApiResult<{ followRequests: FollowRequest[]; activity: Activity[] }>> {
    if (!token) return signedOut();
    return apiFetch("/api/community/notifications", { token });
  },
  answerFollowRequest(token: string | null, userId: string, accept: boolean): Promise<ApiResult<{ followerId: string; accepted: boolean }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/me/follow-requests/${encodeURIComponent(userId)}/${accept ? "accept" : "decline"}`, { method: "POST", token });
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
  messages(token: string | null, conversationId: string, cursor: string | null = null): Promise<ApiResult<Page<"messages", Message> & { other: Member | null }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/conversations/${conversationId}/messages${query({ cursor, limit: 30 })}`, { token });
  },
  sendMessage(token: string | null, conversationId: string, body: string): Promise<ApiResult<{ message: Message }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/community/conversations/${conversationId}/messages`, { method: "POST", body: { body }, token });
  },
};

// Admin-only moderation calls (the server checks the role on every one)
export const adminModeration = {
  openReports(token: string | null): Promise<ApiResult<{ reports: { id: string; postId: string | null; commentId: string | null }[] }>> {
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

export const categoryLabels: Record<PostCategory, string> = { general: "General", meal: "Meal", workout: "Workout", progress: "Progress", achievement: "Achievement" };

// The categories offered when composing ("General" means no tag; "Achievement" stays on older posts)
export const composeCategories: PostCategory[] = ["meal", "workout", "progress", "general"];

export const audienceLabels: Record<PostAudience, { label: string; hint: string }> = {
  public: { label: "Everyone", hint: "Anyone on EATO" },
  followers: { label: "Followers", hint: "Members you've accepted as followers" },
  only_me: { label: "Only me", hint: "Just you" },
};

// The audiences an account may publish to: a private account can't address everyone
// (the server applies the same rule when the post is saved)
export const audiencesFor = (isPrivate: boolean): PostAudience[] => (isPrivate ? ["followers", "only_me"] : ["public", "followers", "only_me"]);
