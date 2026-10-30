// What the friend button shows for each friendship state, so the Friends tab and a profile
// always agree. Pure (no React Native, no "@/" imports) so it is unit-tested with node --test.
// The server decides every state; this only labels it.
export type FriendState = "none" | "outgoing" | "incoming" | "friends";

export type FriendButton = {
  label: string;
  // "primary" = filled (an action to take), "soft" = tinted (already done; tapping undoes it)
  tone: "primary" | "soft";
  // What tapping it does
  action: "request" | "cancel" | "accept" | "remove";
  // Undoing asks first
  confirm: boolean;
};

export function friendButton(state: FriendState): FriendButton {
  switch (state) {
    case "friends":
      return { label: "Friends", tone: "soft", action: "remove", confirm: true };
    case "outgoing":
      return { label: "Requested", tone: "soft", action: "cancel", confirm: true };
    case "incoming":
      return { label: "Accept", tone: "primary", action: "accept", confirm: false };
    default:
      return { label: "Add Friend", tone: "primary", action: "request", confirm: false };
  }
}

// The confirmation for undoing a request or a friendship
export function friendConfirm(action: "cancel" | "remove", name: string): { title: string; text: string; confirmLabel: string } {
  const first = name.trim().split(/\s+/)[0] || "them";
  return action === "cancel"
    ? { title: `Cancel your request to ${first}?`, text: "You can send another one later.", confirmLabel: "Cancel request" }
    : { title: `Remove ${first} as a friend?`, text: "You won't be able to message each other until one of you sends a new request.", confirmLabel: "Remove friend" };
}

// Why messaging is locked (null = it isn't). Same wording as the server's refusal
// (JustFit_server/community/friendRules.js), which is what actually enforces it.
export function messageLockText(state: FriendState, name: string): string | null {
  const first = name.trim().split(/\s+/)[0] || "them";
  if (state === "friends") return null;
  if (state === "outgoing") return `Messaging unlocks when ${first} accepts your friend request.`;
  if (state === "incoming") return `Accept ${first}'s friend request to message them.`;
  return `Add ${first} as a friend to message them.`;
}
