import { apiFetch, type ApiResult } from "@/lib/api";
import type { Closure, FacilityId, GymType, OpeningHours } from "@/lib/gymProfile";

// Gym Hub › Discover Gyms (JustFit_server/gym/discoverRoutes.js, /api/gyms): every gym on justFit,
// read only, with only what each gym chose to show members. Images (coverUrl, logoUrl, photos) are
// read with the session.
export type GymCard = {
  // A justFit admin's pick, shown first (2026-11-10); absent from an older server
  featured?: boolean;
  // Trainers the gym shows members
  trainerCount?: number;
  id: number;
  name: string;
  branch: string;
  area: string;
  city: string;
  // The kind of gym (G16); absent from an older server
  types?: GymType[];
  facilities: FacilityId[];
  // The cheapest membership plan a month, in rupees (null: no plans listed)
  fromPrice: number | null;
  planCount: number;
  photoCount: number;
  coverUrl: string | null;
  logoUrl: string | null;
  // Only when the member shared their location and the gym is on the map
  distanceKm: number | null;
  // Members' reviews (Gym Profile phase 4): null when none, absent from an older server
  rating?: { average: number; count: number } | null;
};
export type GymList = { total: number; page: number; nextPage: number | null; priceCaps: number[]; gyms: GymCard[] };
export type DiscoverSort = "relevance" | "distance";
export type DiscoverQuery = {
  search: string;
  facilities: FacilityId[];
  maxPrice: number | null;
  sort: DiscoverSort;
  near: { latitude: number; longitude: number } | null;
  page?: number;
  // Only gyms that show trainers (2026-11-10)
  trainers?: boolean;
  // Only one kind of gym (G16)
  type?: GymType | null;
};

// savesPerMonth: how much a month less than the shortest plan
// benefits and bestValue (the gym's own pick) since Gym Profile phase 2; absent from an older server
export type ComparePlan = { id: number; name: string; months: number | null; days: number | null; price: number; perMonth: number | null; savesPerMonth: number; details: string | null; benefits?: string[]; bestValue?: boolean; eligibility?: string | null; terms?: string | null };
export type PtPackage = { id: number; name: string; months: number | null; price: number; details: string | null; benefits?: string[]; eligibility?: string | null; terms?: string | null };
// A join request (phase 4): asking a gym to call about a plan; it lands in the gym's Enquiries.
// state: sent (waiting), in_touch (the gym is following up), joined, closed
export type JoinState = "sent" | "in_touch" | "joined" | "closed";
export type JoinRequest = { id: number; gym: { id: number; name: string; branch: string }; planLabel: string | null; state: JoinState; sentOn: string };
// A trainer as members see them; id is the profile's own; photoUrl read with the session
export type PublicTrainer = { id: number; name: string; photoUrl: string | null; specializations: string[]; years: number | null; certifications: string[]; bio: string | null; availability: OpeningHours | null };
// Reviews (Gym Profile phase 4): members of the branch, now or before, rate it once each. The
// average and count include reviews whose words the gym hid; comment is null for those.
export type ReviewSummary = { average: number | null; count: number; counts: Record<"1" | "2" | "3" | "4" | "5", number> };
export type ReviewReply = { text: string; date: string | null };
export type PublicReview = { id: number; name: string; rating: number; comment: string | null; date: string | null; edited: boolean; reply: ReviewReply | null; isYou: boolean };
// The member's own review: hiddenReason set when the gym hid its words
export type HideReason = "abusive" | "spam" | "personal" | "not_member" | "other";
export type MyReview = { id: number; rating: number; comment: string | null; hiddenReason: HideReason | null; reply: ReviewReply | null; date: string | null };
export type GymReviews = { summary: ReviewSummary; reviews: PublicReview[]; nextPage: number | null; mine: MyReview | null; canReview: boolean };
export type GymPage = {
  id: number;
  name: string;
  branch: string;
  area: string;
  city: string;
  about: string | null;
  types?: GymType[];
  facilities: FacilityId[];
  // The gym's own facilities, by name (Gym Profile)
  customFacilities: string[];
  hours: OpeningHours | null;
  // Special closures still to come
  closures: Closure[];
  // Only what the gym switched on for members; a section switched off arrives empty
  contact: { address: string | null; phone: string | null; whatsapp: string | null; email: string | null; website: string | null; instagram: string | null; facebook: string | null };
  location: { latitude: number; longitude: number } | null;
  logoUrl: string | null;
  photos: { id: number; url: string; facility?: FacilityId | null }[];
  plans: ComparePlan[];
  pt: PtPackage[];
  // The gym's trainers members may see (Gym Profile phase 3; absent from an older server)
  trainers?: PublicTrainer[];
  // The newest reviews and the summary; null before the server's reviews migration
  reviews?: GymReviews | null;
  // When the gym last published its profile (null: never, or the gym's own preview)
  updatedAt: string | null;
  // The member here: their membership's id when they are one now, and their latest request.
  // Not sent with the gym's own preview.
  you?: { memberId: number | null; request: JoinRequest | null };
};

const signedOut = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again." });

// The query string: only what is set; the location rounded to about 100 m before it leaves the phone
export function discoverPath(q: DiscoverQuery): string {
  const params: string[] = [];
  if (q.search.trim()) params.push(`search=${encodeURIComponent(q.search.trim().slice(0, 60))}`);
  if (q.facilities.length > 0) params.push(`facilities=${q.facilities.join(",")}`);
  if (q.maxPrice !== null) params.push(`maxPrice=${q.maxPrice}`);
  if (q.near) params.push(`lat=${q.near.latitude.toFixed(3)}`, `lng=${q.near.longitude.toFixed(3)}`);
  if (q.sort !== "relevance") params.push(`sort=${q.sort}`);
  if (q.page && q.page > 1) params.push(`page=${q.page}`);
  if (q.trainers) params.push("trainers=1");
  if (q.type) params.push(`type=${q.type}`);
  return `/api/gyms${params.length ? `?${params.join("&")}` : ""}`;
}

export const discoverApi = {
  gyms: (token: string | null, q: DiscoverQuery) => (token ? apiFetch<GymList>(discoverPath(q), { token }) : signedOut<GymList>()),
  gym: (token: string | null, id: number) => (token ? apiFetch<GymPage>(`/api/gyms/${id}`, { token }) : signedOut<GymPage>()),
  // Ask the gym to call about a plan or PT package (or neither); the name and number are the account's
  ask: (token: string | null, gymId: number, body: { itemId: number | null; note: string }) =>
    token ? apiFetch<{ request: JoinRequest }>(`/api/gyms/${gymId}/requests`, { token, method: "POST", body: { itemId: body.itemId, note: body.note.trim() || null } }) : signedOut<{ request: JoinRequest }>(),
  // Reviews: a page of them; the member's own written, changed or deleted (answers the newest few)
  reviews: (token: string | null, gymId: number, page = 1) => (token ? apiFetch<GymReviews>(`/api/gyms/${gymId}/reviews${page > 1 ? `?page=${page}` : ""}`, { token }) : signedOut<GymReviews>()),
  saveReview: (token: string | null, gymId: number, body: { rating: number; comment: string }) =>
    token ? apiFetch<GymReviews>(`/api/gyms/${gymId}/review`, { token, method: "PUT", body: { rating: body.rating, comment: body.comment.trim() || null } }) : signedOut<GymReviews>(),
  deleteReview: (token: string | null, gymId: number) => (token ? apiFetch<GymReviews>(`/api/gyms/${gymId}/review`, { token, method: "DELETE" }) : signedOut<GymReviews>()),
  requests: (token: string | null) => (token ? apiFetch<{ requests: JoinRequest[] }>("/api/gyms/requests", { token }) : signedOut<{ requests: JoinRequest[] }>()),
};
