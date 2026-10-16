import type { Member, Story, StoryGroup } from "@/lib/community";

// The ring around a member's photo, in the stories row and on their profile:
//   - none: no active story the viewer may see (the server leaves such members out)
//   - unseen: blue, at least one story the viewer hasn't seen (always for your own stories)
//   - close: green, an unseen Close Friends story (for your own: every story is Close Friends)
//   - seen: every story seen, shown as the plain circle, as before
export type StoryRing = "none" | "unseen" | "close" | "seen";

export function storyRingFor(group: StoryGroup | null | undefined): StoryRing {
  if (!group || group.stories.length === 0) return "none";
  if (group.isOwn) return group.stories.every((story) => story.audience === "close_friends") ? "close" : "unseen";
  if (group.allViewed) return "seen";
  return group.stories.some((story) => !story.viewed && story.audience === "close_friends") ? "close" : "unseen";
}

export const storyRingClass: Record<StoryRing, string> = {
  none: "story__ring",
  seen: "story__ring",
  unseen: "story__ring story__ring--new",
  close: "story__ring story__ring--close",
};

// The row right after publishing: the new story joins the member's own group (first in the
// row, oldest story first), once, even if the same story comes back again on a Retry
export function withOwnStory(groups: StoryGroup[], story: Story): StoryGroup[] {
  const own = groups.find((group) => group.isOwn);
  if (own?.stories.some((item) => item.id === story.id)) return groups;
  const member: Member = own?.member ?? story.author;
  const updated: StoryGroup = { member, isOwn: true, allViewed: true, stories: [...(own?.stories ?? []), story] };
  return [updated, ...groups.filter((group) => !group.isOwn)];
}
