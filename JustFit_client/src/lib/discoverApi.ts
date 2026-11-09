import { apiFetch, type ApiResult } from "@/lib/api";
import type { FacilityId, OpeningHours } from "@/lib/gymProfile";

// Gym Hub › Discover Gyms (JustFit_server/gym/discoverRoutes.js, /api/gyms): every gym on justFit,
// read only, with only what each gym chose to show members. Images (coverUrl, logoUrl, photos) are
// read with the session.
export type GymCard = {
  id: number;
  name: string;
  branch: string;
  area: string;
  city: string;
  facilities: FacilityId[];
  // The cheapest membership plan a month, in rupees (null: no plans listed)
  fromPrice: number | null;
  planCount: number;
  photoCount: number;
  coverUrl: string | null;
  logoUrl: string | null;
  // Only when the member shared their location and the gym is on the map
  distanceKm: number | null;
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
};

// savesPerMonth: how much a month less than the shortest plan
export type ComparePlan = { id: number; name: string; months: number | null; days: number | null; price: number; perMonth: number | null; savesPerMonth: number; details: string | null };
export type PtPackage = { id: number; name: string; months: number | null; price: number; details: string | null };
// A join request (phase 4): asking a gym to call about a plan; it lands in the gym's Enquiries.
// state: sent (waiting), in_touch (the gym is following up), joined, closed
export type JoinState = "sent" | "in_touch" | "joined" | "closed";
export type JoinRequest = { id: number; gym: { id: number; name: string; branch: string }; planLabel: string | null; state: JoinState; sentOn: string };
export type GymPage = {
  id: number;
  name: string;
  branch: string;
  area: string;
  city: string;
  about: string | null;
  facilities: FacilityId[];
  hours: OpeningHours | null;
  contact: { address: string | null; phone: string | null };
  location: { latitude: number; longitude: number } | null;
  logoUrl: string | null;
  photos: { id: number; url: string }[];
  plans: ComparePlan[];
  pt: PtPackage[];
  // The member here: their membership's id when they are one now, and their latest request
  you: { memberId: number | null; request: JoinRequest | null };
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
  return `/api/gyms${params.length ? `?${params.join("&")}` : ""}`;
}

export const discoverApi = {
  gyms: (token: string | null, q: DiscoverQuery) => (token ? apiFetch<GymList>(discoverPath(q), { token }) : signedOut<GymList>()),
  gym: (token: string | null, id: number) => (token ? apiFetch<GymPage>(`/api/gyms/${id}`, { token }) : signedOut<GymPage>()),
  // Ask the gym to call about a plan or PT package (or neither); the name and number are the account's
  ask: (token: string | null, gymId: number, body: { itemId: number | null; note: string }) =>
    token ? apiFetch<{ request: JoinRequest }>(`/api/gyms/${gymId}/requests`, { token, method: "POST", body: { itemId: body.itemId, note: body.note.trim() || null } }) : signedOut<{ request: JoinRequest }>(),
  requests: (token: string | null) => (token ? apiFetch<{ requests: JoinRequest[] }>("/api/gyms/requests", { token }) : signedOut<{ requests: JoinRequest[] }>()),
};
