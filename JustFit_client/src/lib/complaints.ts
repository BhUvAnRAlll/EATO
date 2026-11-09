import { apiFetch, type ApiResult } from "@/lib/api";

// Reporting a gym and working the cases (JustFit_server/complaints/, the brief's section 7). A member
// reports a branch and later sees the status and resolution; justFit admins assign, note and close.

export type ComplaintCategory = "safety" | "billing" | "staff" | "facility" | "false_info" | "other";
export type ComplaintStatus = "open" | "investigating" | "resolved" | "dismissed";
export const COMPLAINT_CATEGORIES: { id: ComplaintCategory; label: string }[] = [
  { id: "safety", label: "Safety" },
  { id: "billing", label: "Fees or billing" },
  { id: "staff", label: "Staff behaviour" },
  { id: "facility", label: "Facilities or hygiene" },
  { id: "false_info", label: "Wrong information" },
  { id: "other", label: "Something else" },
];
export const COMPLAINT_STATUSES: { id: ComplaintStatus | "active" | "all"; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "open", label: "Open" },
  { id: "investigating", label: "Investigating" },
  { id: "resolved", label: "Resolved" },
  { id: "dismissed", label: "Dismissed" },
  { id: "all", label: "All" },
];
export const DETAILS_MIN = 20;
export const DETAILS_MAX = 1000;

export type MemberComplaint = { id: number; gym: { id: number; name: string; branch: string }; category: ComplaintCategory; categoryLabel: string; status: ComplaintStatus; statusLabel: string; resolution: string | null; createdAt: string | null; updatedAt: string | null };
export type AdminComplaintRow = MemberComplaint & { city: string; reporter: string; assignee: string | null; preview: string };
export type AdminComplaintList = { page: number; nextPage: number | null; counts: Record<ComplaintStatus | "active" | "all", number>; complaints: AdminComplaintRow[] };
export type AdminComplaint = {
  complaint: MemberComplaint & { city: string; details: string; reporter: { id: string | null; name: string; phone: string | null }; assignee: { id: string; name: string } | null; otherReportsAboutGym: number };
  history: { kind: "created" | "assigned" | "note" | "status"; status: ComplaintStatus | null; note: string | null; by: string; at: string | null }[];
};

const signedOut = <T,>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again.", status: 401 });
const call = <T,>(token: string | null, path: string, options: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<ApiResult<T>> =>
  token ? apiFetch<T>(path, { ...options, token }) : signedOut<T>();

export const complaintsApi = {
  report: (token: string | null, body: { gymId: number; category: ComplaintCategory; details: string }) => call<{ complaint: MemberComplaint }>(token, "/api/complaints", { method: "POST", body }),
  mine: (token: string | null) => call<{ complaints: MemberComplaint[] }>(token, "/api/complaints"),
  list: (token: string | null, status: string, page = 1) => call<AdminComplaintList>(token, `/api/admin/portal/complaints?status=${status}${page > 1 ? `&page=${page}` : ""}`),
  detail: (token: string | null, id: number) => call<AdminComplaint>(token, `/api/admin/portal/complaints/${id}`),
  assign: (token: string | null, id: number) => call<AdminComplaint>(token, `/api/admin/portal/complaints/${id}/assign`, { method: "POST" }),
  note: (token: string | null, id: number, note: string) => call<AdminComplaint>(token, `/api/admin/portal/complaints/${id}/notes`, { method: "POST", body: { note } }),
  status: (token: string | null, id: number, status: ComplaintStatus, resolution: string) =>
    call<AdminComplaint>(token, `/api/admin/portal/complaints/${id}/status`, { method: "POST", body: { status, ...(resolution.trim() ? { resolution: resolution.trim() } : {}) } }),
};
