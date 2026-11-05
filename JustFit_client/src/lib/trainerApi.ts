import { apiFetch, type ApiResult } from "@/lib/api";

// A gym trainer's PT clients (JustFit_server/gym/trainerRoutes.js, mounted at /api/trainer). The
// server decides who is a trainer and whose clients they are; nothing here picks a member.

// pt.daysLeft: 0 on its last day, negative once it has ended (ended PT shows for 30 days)
export type TrainerClient = {
  id: number;
  code: string;
  name: string;
  phone: string | null; // +91XXXXXXXXXX
  photoUrl: string | null;
  branch: string;
  pt: { label: string; from: string; until: string; active: boolean; daysLeft: number };
  inToday: boolean;
};
export type TrainerClients = { gym: string | null; branches: string[]; clients: TrainerClient[] };
export type ClientVisit = { onDate: string; inAt: string; outAt: string | null; status: "inside" | "completed" | "no_checkout"; durationMin: number | null };
export type TrainerClientDetail = { client: TrainerClient; visits: ClientVisit[] };

const signedOut = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again." });

export const trainerApi = {
  clients: (token: string | null) => (token ? apiFetch<TrainerClients>("/api/trainer/clients", { token }) : signedOut<TrainerClients>()),
  client: (token: string | null, id: number) => (token ? apiFetch<TrainerClientDetail>(`/api/trainer/clients/${id}`, { token }) : signedOut<TrainerClientDetail>()),
};

// "12 days left", "Ends today", "Ended 5 days ago"
export function ptLeftText(daysLeft: number): string {
  if (daysLeft > 1) return `${daysLeft} days left`;
  if (daysLeft === 1) return "Ends tomorrow";
  if (daysLeft === 0) return "Ends today";
  return daysLeft === -1 ? "Ended yesterday" : `Ended ${-daysLeft} days ago`;
}
