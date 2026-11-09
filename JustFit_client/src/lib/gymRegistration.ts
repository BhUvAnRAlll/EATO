import { apiFetch, type ApiResult } from "@/lib/api";
import type { AdminApplication, AdminGymList, Application, ApplicationFields, DocumentKind, GymListFilter, MyRegistrations, ReviewAction, Upload } from "@/lib/gymRegistrationRules";

export * from "@/lib/gymRegistrationRules";

// Register your gym (JustFit_server/gym/registrationRoutes.js, /api/gym-registration): a member
// applies, fills in the business, the place, the gym, its pictures and documents, and submits it;
// the justFit team reviews it (JustFit_server/admin/routes.js, adminReviewApi).

const signedOut = <T,>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again.", status: 401 });
const call = <T,>(token: string | null, path: string, options: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown } = {}): Promise<ApiResult<T>> =>
  token ? apiFetch<T>(path, { ...options, token }) : signedOut<T>();

export const registrationApi = {
  mine: (token: string | null) => call<MyRegistrations>(token, "/api/gym-registration"),
  start: (token: string | null, fields: { gymName: string; area: string; city: string; branch?: string }) => call<Application>(token, "/api/gym-registration", { method: "POST", body: fields }),
  edit: (token: string | null, id: number, fields: ApplicationFields) => call<Application>(token, `/api/gym-registration/${id}`, { method: "PATCH", body: fields }),
  submit: (token: string | null, id: number) => call<Application>(token, `/api/gym-registration/${id}/submit`, { method: "POST" }),
  addDocument: (token: string | null, id: number, kind: DocumentKind, file: Upload) =>
    call<Application>(token, `/api/gym-registration/${id}/documents`, { method: "POST", body: { kind, data: file.data, mediaType: file.mediaType } }),
  removeDocument: (token: string | null, id: number, documentId: number) => call<Application>(token, `/api/gym-registration/${id}/documents/${documentId}`, { method: "DELETE" }),
  setLogo: (token: string | null, id: number, file: Upload) => call<Application>(token, `/api/gym-registration/${id}/logo`, { method: "PUT", body: file }),
  addPhoto: (token: string | null, id: number, file: Upload) => call<Application>(token, `/api/gym-registration/${id}/photos`, { method: "POST", body: file }),
  removePhoto: (token: string | null, id: number, photoId: number) => call<Application>(token, `/api/gym-registration/${id}/photos/${photoId}`, { method: "DELETE" }),
};

export const adminReviewApi = {
  list: (token: string | null, filter: GymListFilter) => call<AdminGymList>(token, `/api/admin/portal/gyms${filter === "all" ? "" : `?status=${filter}`}`),
  application: (token: string | null, gymId: number) => call<AdminApplication>(token, `/api/admin/portal/gyms/${gymId}/application`),
  decide: (token: string | null, gymId: number, action: ReviewAction, note: string) =>
    call<AdminApplication>(token, `/api/admin/portal/gyms/${gymId}/decision`, { method: "POST", body: { action, ...(note.trim() ? { note: note.trim() } : {}) } }),
};
