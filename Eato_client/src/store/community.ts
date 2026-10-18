import { create } from "zustand";

import { community, type Post, type Story, type StoryGroup } from "@/lib/community";
import { withOwnStory } from "@/lib/storyRing";

// What the Community tab shows: the feed, the stories row, the groups and the unread
// message count. Kept here so likes, joins and new posts stay in step across screens and
// a screen that mounts again doesn't ask the server again within the freshness window.

const FRESH_FOR_MS = 30 * 1000;

type Status = "idle" | "loading" | "ready" | "error";

type CommunityState = {
  // The session token of the last load, for authenticated images
  token: string | null;
  feed: Post[];
  feedCursor: string | null;
  feedStatus: Status;
  feedError: string | null;
  feedLoadedAt: number | null;
  loadingMore: boolean;
  stories: StoryGroup[];
  unreadCount: number;
  // Pending follow requests (the bell's badge)
  requestCount: number;

  setToken: (token: string | null) => void;
  loadFeed: (token: string | null, options?: { force?: boolean }) => Promise<void>;
  loadMoreFeed: (token: string | null) => Promise<void>;
  loadUnread: (token: string | null) => Promise<void>;
  // Local updates after a successful mutation elsewhere
  upsertPost: (post: Post) => void;
  removePost: (postId: string) => void;
  patchPost: (postId: string, changes: Partial<Post>) => void;
  toggleLike: (token: string | null, postId: string) => Promise<string | null>;
  markStoriesViewed: (memberId: string) => void;
  // Refreshes only the stories row (after publishing, or when a profile opens), whatever
  // state the feed is in
  loadStories: (token: string | null) => Promise<void>;
  // Shows a story the member just published straight away, before the refresh answers
  addStory: (story: Story) => void;
  // Drops one story (deleted, ended or no longer visible); a member with none left leaves the row
  removeStory: (storyId: string) => void;
};

export const useCommunityStore = create<CommunityState>((set, get) => ({
  token: null,
  feed: [],
  feedCursor: null,
  feedStatus: "idle",
  feedError: null,
  feedLoadedAt: null,
  loadingMore: false,
  stories: [],
  unreadCount: 0,
  requestCount: 0,

  setToken: (token) => set({ token }),

  // The first page of the feed, the stories and the unread count together
  loadFeed: async (token, { force = false } = {}) => {
    const { feedStatus, feedLoadedAt } = get();
    if (feedStatus === "loading") return;
    if (!force && feedLoadedAt !== null && Date.now() - feedLoadedAt < FRESH_FOR_MS) return;
    set({ feedStatus: "loading", feedError: null, token });
    const [feed, stories, conversations, notifications] = await Promise.all([
      community.feed(token), community.stories(token), community.conversations(token), community.notifications(token),
    ]);
    if (!feed.ok) {
      // The previous content stays on screen; the error (offline or server) is shown above it
      set({ feedStatus: "error", feedError: feed.error });
      return;
    }
    set({
      feed: feed.data.posts,
      feedCursor: feed.data.nextCursor,
      feedStatus: "ready",
      feedLoadedAt: Date.now(),
      stories: stories.ok ? stories.data.members : get().stories,
      unreadCount: conversations.ok ? conversations.data.unreadCount : get().unreadCount,
      requestCount: notifications.ok ? notifications.data.requestCount : get().requestCount,
    });
  },

  loadMoreFeed: async (token) => {
    const { feedCursor, loadingMore, feed } = get();
    if (!feedCursor || loadingMore) return;
    set({ loadingMore: true });
    const result = await community.feed(token, feedCursor);
    if (result.ok) {
      const known = new Set(feed.map((post) => post.id));
      set({ feed: [...feed, ...result.data.posts.filter((post) => !known.has(post.id))], feedCursor: result.data.nextCursor });
    }
    set({ loadingMore: false });
  },

  loadUnread: async (token) => {
    const [conversations, notifications] = await Promise.all([community.conversations(token), community.notifications(token)]);
    if (conversations.ok) set({ unreadCount: conversations.data.unreadCount });
    if (notifications.ok) set({ requestCount: notifications.data.requestCount });
  },

  upsertPost: (post) =>
    set((state) => {
      const exists = state.feed.some((item) => item.id === post.id);
      if (exists) return { feed: state.feed.map((item) => (item.id === post.id ? post : item)) };
      // A main-feed post goes to the top; gym posts live on the gym's screen
      return post.gymId ? {} : { feed: [post, ...state.feed] };
    }),

  removePost: (postId) => set((state) => ({ feed: state.feed.filter((post) => post.id !== postId) })),

  patchPost: (postId, changes) => set((state) => ({ feed: state.feed.map((post) => (post.id === postId ? { ...post, ...changes } : post)) })),

  // Optimistic like with rollback; returns an error line on failure
  toggleLike: async (token, postId) => {
    const post = get().feed.find((item) => item.id === postId);
    if (!post) return null;
    const liked = !post.liked;
    get().patchPost(postId, { liked, likeCount: Math.max(0, post.likeCount + (liked ? 1 : -1)) });
    const result = await community.setLike(token, postId, liked);
    if (!result.ok) {
      get().patchPost(postId, { liked: post.liked, likeCount: post.likeCount });
      return result.error;
    }
    get().patchPost(postId, { liked: result.data.liked, likeCount: result.data.likeCount });
    return null;
  },


  loadStories: async (token) => {
    const result = await community.stories(token);
    if (result.ok) set({ stories: result.data.members });
  },

  addStory: (story) => set((state) => ({ stories: withOwnStory(state.stories, story) })),

  removeStory: (storyId) =>
    set((state) => ({
      stories: state.stories
        .map((entry) => ({ ...entry, stories: entry.stories.filter((story) => story.id !== storyId) }))
        .filter((entry) => entry.stories.length > 0),
    })),

  markStoriesViewed: (memberId) =>
    set((state) => ({
      stories: state.stories.map((entry) =>
        entry.member.id === memberId ? { ...entry, allViewed: true, stories: entry.stories.map((story) => ({ ...story, viewed: true })) } : entry,
      ),
    })),
}));
