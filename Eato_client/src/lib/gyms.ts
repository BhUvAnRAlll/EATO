import * as Linking from "expo-linking";

import { apiFetch, type ApiResult } from "@/lib/api";
import type { FriendState, Member, NewPost, Page, Post } from "@/lib/community";
import type { GymRole, GymVisibility, MembershipStatus } from "@/lib/gymRules";

// Calls for gym communities (Eato_server/gyms/). `token` is the Clerk session token. The
// server checks every permission; `can` on a gym only tells the screens what to offer.

export type GymMembership = { role: GymRole; status: MembershipStatus };

export type GymSettings = {
  whoCanPost: "everyone" | "trainers" | "admins";
  whoCanComment: "members" | "trainers" | "off";
  whoCanCreateEvents: "admins" | "trainers" | "members";
  memberApproval: boolean;
  postModeration: boolean;
};

export type MembershipTier = { name: string; price: string; perks: string };

export type Gym = {
  id: string;
  name: string;
  tagline: string | null;
  description: string | null;
  location: string | null;
  address: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  hours: { label: string; value: string }[];
  facilities: string[];
  membershipTiers: MembershipTier[];
  guidelines: string[];
  contact: { phone: string | null; email: string | null; website: string | null };
  visibility: GymVisibility;
  settings: GymSettings;
  plan: "starter" | "pro" | "elite";
  memberCount: number;
  inviteCode: string | null; // staff only
  membership: GymMembership | null;
  joinMode: "join" | "request";
  can: { viewContent: boolean; post: boolean; comment: boolean; createEvents: boolean; invite: boolean; manage: boolean; moderate: boolean; leave: boolean };
};

// title: a trainer's headline; friendState: the viewer's friendship with them (message or lock)
export type GymMember = { member: Member; role: GymRole; status: MembershipStatus; since: string; isMe: boolean; title: string | null; friendState: FriendState };
export type Announcement = { id: string; gymId: string; title: string; body: string; pinned: boolean; author: Member | null; createdAt: string; updatedAt: string };
export type GymEvent = {
  id: string; gymId: string; title: string; description: string; date: string; startTime: string; endTime: string; location: string;
  maxAttendees: number | null; attendeeCount: number; full: boolean; going: boolean; host: Member | null; isHost: boolean;
  attendeesPreview?: Member[]; // the first few going (event lists only)
};
export type Invitation = {
  id: string; code: string; channel: "link" | "qr" | "email" | "phone"; contact: string | null; role: "member" | "trainer";
  status: "pending" | "accepted" | "revoked" | "expired"; invitedBy: Member | null; expiresAt: string; createdAt: string;
};

// An email invitation addressed to the signed-in member (shown as a banner on the Gyms tab)
export type MyInvitation = { code: string; role: "member" | "trainer"; expiresAt: string; invitedBy: Member | null; gym: { id: string; name: string; location: string | null; logoUrl: string | null } };

export type GymProfileChanges = Partial<{
  name: string; tagline: string | null; description: string | null; location: string | null; address: string | null;
  logoMediaId: string | null; coverMediaId: string | null; hours: Gym["hours"]; facilities: string[]; membershipTiers: MembershipTier[];
  guidelines: string[]; contactPhone: string | null; contactEmail: string | null; contactWebsite: string | null;
}>;
export type GymSettingsChanges = Partial<GymSettings & { visibility: GymVisibility; plan: Gym["plan"] }>;
export type EventDraft = { title: string; description: string; date: string; startTime: string; endTime: string; location: string; maxAttendees?: number | null };

const signedOut = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again." });
const q = (params: Record<string, string | null | undefined>) => {
  const parts = Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
};
const call = <T>(token: string | null, path: string, init: { method?: "POST" | "PATCH" | "DELETE"; body?: unknown } = {}): Promise<ApiResult<T>> =>
  token ? apiFetch(`/api/gyms${path}`, { ...init, token }) : signedOut();

export const gyms = {
  list: (token: string | null, search: string | null = null) => call<{ mine: Gym[]; explore: Gym[] }>(token, `${q({ search })}`),
  get: (token: string | null, gymId: string) => call<{ gym: Gym }>(token, `/${gymId}`),
  // Invitations sent to one of the caller's verified emails
  myInvitations: (token: string | null) => call<{ invitations: MyInvitation[] }>(token, "/invitations/mine"),
  // Platform admins only: every gym, hidden ones included
  listAll: (token: string | null) => call<{ gyms: Gym[] }>(token, "/admin/all"),
  // Gym admins: a new gym code (the old one stops working)
  rotateCode: (token: string | null, gymId: string) => call<{ gym: Gym }>(token, `/${gymId}/code/rotate`, { method: "POST" }),
  create: (token: string | null, body: { name: string; tagline?: string | null; location?: string | null; ownerEmail: string; visibility?: GymVisibility; memberApproval?: boolean }) =>
    call<{ gym: Gym }>(token, "", { method: "POST", body }),
  updateProfile: (token: string | null, gymId: string, changes: GymProfileChanges) => call<{ gym: Gym }>(token, `/${gymId}`, { method: "PATCH", body: changes }),
  updateSettings: (token: string | null, gymId: string, changes: GymSettingsChanges) => call<{ gym: Gym }>(token, `/${gymId}/settings`, { method: "PATCH", body: changes }),

  join: (token: string | null, gymId: string) => call<{ gym: Gym }>(token, `/${gymId}/join`, { method: "POST" }),
  leave: (token: string | null, gymId: string) => call<{ left: true }>(token, `/${gymId}/join`, { method: "DELETE" }),
  // Which gym a code opens, its role, and who sent it (null for a gym's own code)
  previewCode: (token: string | null, code: string) => call<{ gym: Gym; role: "member" | "trainer"; invitedBy: Member | null }>(token, `/codes/${encodeURIComponent(code)}`),
  joinByCode: (token: string | null, code: string) => call<{ gym: Gym }>(token, "/join-by-code", { method: "POST", body: { code } }),

  members: (token: string | null, gymId: string, status: MembershipStatus = "active") => call<{ members: GymMember[] }>(token, `/${gymId}/members${q({ status })}`),
  changeMember: (token: string | null, gymId: string, userId: string, change: { role?: Exclude<GymRole, "owner">; status?: "active" | "suspended" }) =>
    call<{ userId: string; role: GymRole; status: MembershipStatus }>(token, `/${gymId}/members/${encodeURIComponent(userId)}`, { method: "PATCH", body: change }),
  removeMember: (token: string | null, gymId: string, userId: string) => call<{ removed: true }>(token, `/${gymId}/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),

  // One event with everyone going; canCancel for the host and gym admins
  event: (token: string | null, gymId: string, eventId: string) => call<{ event: GymEvent & { attendees: Member[]; canCancel: boolean } }>(token, `/${gymId}/events/${eventId}`),
  // The gym's assistant (same agent as WhatsApp): one question, an answer from the gym's own facts
  ask: (token: string | null, gymId: string, question: string) => call<{ reply: string; escalated: boolean; contact: string | null }>(token, `/${gymId}/assistant`, { method: "POST", body: { question } }),
  posts: (token: string | null, gymId: string, cursor: string | null = null) => call<Page<"posts", Post>>(token, `/${gymId}/posts${q({ cursor, limit: "20" })}`),
  createPost: (token: string | null, gymId: string, body: Omit<NewPost, "audience">) =>
    call<{ post: Post }>(token, `/${gymId}/posts`, { method: "POST", body }),
  approvePost: (token: string | null, gymId: string, postId: string) => call<{ id: string; reviewStatus: "published" }>(token, `/${gymId}/posts/${postId}/approve`, { method: "POST" }),
  removePost: (token: string | null, gymId: string, postId: string) => call<{ deleted: true }>(token, `/${gymId}/posts/${postId}`, { method: "DELETE" }),

  announcements: (token: string | null, gymId: string) => call<{ announcements: Announcement[] }>(token, `/${gymId}/announcements`),
  createAnnouncement: (token: string | null, gymId: string, body: { title: string; body: string; pinned?: boolean }) =>
    call<{ announcement: Announcement }>(token, `/${gymId}/announcements`, { method: "POST", body }),
  updateAnnouncement: (token: string | null, gymId: string, id: string, body: Partial<{ title: string; body: string; pinned: boolean }>) =>
    call<{ announcement: Announcement }>(token, `/${gymId}/announcements/${id}`, { method: "PATCH", body }),
  deleteAnnouncement: (token: string | null, gymId: string, id: string) => call<{ deleted: true }>(token, `/${gymId}/announcements/${id}`, { method: "DELETE" }),

  events: (token: string | null, gymId: string) => call<{ events: GymEvent[] }>(token, `/${gymId}/events`),
  createEvent: (token: string | null, gymId: string, body: EventDraft) => call<{ event: GymEvent }>(token, `/${gymId}/events`, { method: "POST", body }),
  deleteEvent: (token: string | null, gymId: string, eventId: string) => call<{ deleted: true }>(token, `/${gymId}/events/${eventId}`, { method: "DELETE" }),
  setRsvp: (token: string | null, gymId: string, eventId: string, going: boolean) =>
    call<{ event: GymEvent }>(token, `/${gymId}/events/${eventId}/rsvp`, { method: going ? "POST" : "DELETE" }),

  invitations: (token: string | null, gymId: string) => call<{ invitations: Invitation[] }>(token, `/${gymId}/invitations`),
  createInvitation: (token: string | null, gymId: string, body: { channel: Invitation["channel"]; contact?: string | null; role?: Invitation["role"] }) =>
    call<{ invitation: Invitation }>(token, `/${gymId}/invitations`, { method: "POST", body }),
  changeInvitation: (token: string | null, gymId: string, id: string, action: "revoke" | "renew") =>
    call<{ invitation: Invitation }>(token, `/${gymId}/invitations/${id}/${action}`, { method: "POST" }),
};

// The link that opens an invitation in EATO (eato://community/gyms/invite/CODE in a build)
export const inviteLink = (code: string) => Linking.createURL(`/community/gyms/invite/${code}`);
