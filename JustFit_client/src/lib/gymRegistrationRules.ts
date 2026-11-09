import type { AdminGymRow } from "./gymApi";
import type { FacilityId, OpeningHours } from "./gymProfile";

// Register your gym and the Super Admin's review (Gym Hub ecosystem phase 1): the types, the words
// and the small rules, pure so they are unit-tested (lib/__tests__/gymRegistration.test.ts). The
// calls to the server are in lib/gymRegistration.ts.

export type GymStatus = "draft" | "submitted" | "pending_review" | "approved" | "rejected" | "suspended";
export type BusinessType = "individual" | "partnership" | "private_limited" | "llp" | "other";
export type DocumentKind = "registration" | "address" | "other";
export type SectionKey = "business" | "location" | "gym" | "documents";

export type RegistrationDocument = { id: number; kind: DocumentKind; mediaType: string; bytes: number; uploadedAt: string | null; url: string };
export type HistoryStep = { action: string; text: string; from: GymStatus | null; to: GymStatus; note: string | null; by: string; at: string | null };
export type Application = {
  id: number;
  gymName: string;
  branch: string;
  legalName: string | null;
  businessType: BusinessType | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  address: string | null;
  area: string;
  city: string;
  state: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  about: string | null;
  facilities: FacilityId[];
  hours: OpeningHours | null;
  status: GymStatus;
  statusLabel: string;
  statusNote: string | null;
  submittedAt: string | null;
  logoUrl: string | null;
  photos: { id: number; url: string }[];
  documents: RegistrationDocument[];
  history: HistoryStep[];
  missing: { key: SectionKey; text: string }[];
  canEdit: boolean;
  canSubmit: boolean;
};
export type ApplicationSummary = { id: number; gymName: string; branch: string; city: string; status: GymStatus; statusLabel: string; statusNote: string | null; submittedAt: string | null };
export type MyRegistrations = { canStart: boolean; current: Application | null; applications: ApplicationSummary[] };

export type ApplicationFields = Partial<{
  gymName: string;
  branch: string;
  legalName: string | null;
  businessType: BusinessType | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  address: string | null;
  area: string;
  city: string;
  state: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  about: string | null;
  facilities: FacilityId[];
  hours: OpeningHours | null;
}>;
export type Upload = { data: string; mediaType: string };

export const BUSINESS_TYPES: { id: BusinessType; label: string }[] = [
  { id: "individual", label: "Individual / proprietor" },
  { id: "partnership", label: "Partnership" },
  { id: "private_limited", label: "Private limited" },
  { id: "llp", label: "LLP" },
  { id: "other", label: "Other" },
];
export const DOCUMENT_KINDS: { id: DocumentKind; label: string; hint: string }[] = [
  { id: "address", label: "Address proof", hint: "Rent agreement, electricity bill or property tax receipt. Required." },
  { id: "registration", label: "Business registration", hint: "GST, shop and establishment, Udyam or company certificate, where you have one." },
  { id: "other", label: "Other supporting document", hint: "Anything else that helps us verify the gym." },
];
export const STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
];
export const MAX_DOCUMENTS = 8;

export const SECTIONS: { key: SectionKey; title: string; line: string; href: "/gym-register/business" | "/gym-register/location" | "/gym-register/gym" | "/gym-register/files" }[] = [
  { key: "business", title: "Business and contact", line: "Who runs the gym and how we reach you", href: "/gym-register/business" },
  { key: "location", title: "Location", line: "The address members will visit", href: "/gym-register/location" },
  { key: "gym", title: "About the gym", line: "Description, facilities and opening hours", href: "/gym-register/gym" },
  { key: "documents", title: "Photos and documents", line: "Logo, cover photo and verification documents", href: "/gym-register/files" },
];

// What the applicant reads about where their application stands
export function statusMessage(app: Pick<Application, "status" | "statusNote" | "gymName">): { title: string; body: string; tone: "neutral" | "good" | "warn" | "bad" } {
  switch (app.status) {
    case "draft":
      return app.statusNote
        ? { title: "justFit needs a little more", body: app.statusNote, tone: "warn" }
        : { title: "Finish your application", body: "Fill in each section, then submit it for review.", tone: "neutral" };
    case "submitted":
      return { title: "Submitted", body: "We've received your application. Our team usually reviews it within 2 working days.", tone: "neutral" };
    case "pending_review":
      return { title: "Under review", body: "Our team is checking your details and documents.", tone: "neutral" };
    case "approved":
      return { title: `${app.gymName} is approved`, body: "Your account is now the gym's admin. Open the gym portal to set up plans, members and your public profile.", tone: "good" };
    case "rejected":
      return { title: "Not approved", body: app.statusNote ?? "Your application wasn't approved. You can change it and send it again.", tone: "bad" };
    case "suspended":
      return { title: "Suspended", body: app.statusNote ?? "justFit has suspended this gym for now.", tone: "bad" };
  }
}

// How many of a section's items are still missing (0: done)
export const missingIn = (app: Pick<Application, "missing">, key: SectionKey) => app.missing.filter((m) => m.key === key).length;

export const documentLabel = (kind: DocumentKind) => DOCUMENT_KINDS.find((d) => d.id === kind)?.label ?? "Document";

// "240 KB" / "1.2 MB"
export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// "" → null, so clearing a field clears it on the server
export const orNull = (text: string) => (text.trim() === "" ? null : text.trim());

// ─── Super Admin › Gyms: the approval review (JustFit_server/admin/routes.js) ─────────────────

export type GymListFilter = "all" | "review" | GymStatus;
export const LIST_FILTERS: { id: GymListFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "review", label: "To review" },
  { id: "approved", label: "Approved" },
  { id: "draft", label: "Draft" },
  { id: "rejected", label: "Rejected" },
  { id: "suspended", label: "Suspended" },
];
export type AdminGymListRow = AdminGymRow & { status?: GymStatus; statusLabel?: string; statusNote?: string | null };
// counts is null before the server's 2026-12-27 migration (every gym then counts as approved)
export type AdminGymList = { gyms: AdminGymListRow[]; counts: (Record<GymStatus | "all" | "review", number>) | null };

export type ReviewAction = "start_review" | "approve" | "reject" | "request_documents" | "request_changes" | "suspend" | "reactivate";
export type AdminApplication = Application & { applicant: { id: string; name: string; phone: string | null } | null; actions: ReviewAction[] };

// The review's buttons: what each says, whether it asks for a reason, and how it reads when done
export const REVIEW_ACTIONS: Record<ReviewAction, { label: string; reason: "required" | "optional" | "none"; prompt: string; done: string; danger?: boolean }> = {
  start_review: { label: "Start review", reason: "none", prompt: "", done: "Review started" },
  approve: { label: "Approve", reason: "optional", prompt: "A note for the gym (optional)", done: "Gym approved" },
  request_documents: { label: "Request documents", reason: "required", prompt: "Which documents are needed?", done: "Documents requested" },
  request_changes: { label: "Request changes", reason: "required", prompt: "What needs to change?", done: "Changes requested" },
  reject: { label: "Reject", reason: "required", prompt: "Why is it rejected?", done: "Gym rejected", danger: true },
  suspend: { label: "Suspend gym", reason: "required", prompt: "Why is it suspended?", done: "Gym suspended", danger: true },
  reactivate: { label: "Reactivate", reason: "optional", prompt: "A note for the gym (optional)", done: "Gym reactivated" },
};

// Whether a reason the admin typed is enough for the action (the server checks again)
export function reasonProblem(action: ReviewAction, note: string): string | null {
  const text = note.trim();
  if (REVIEW_ACTIONS[action].reason === "required" && text.length < 5) return "Write the reason so the gym knows what to do.";
  if (text.length > 300) return "Keep it to 300 characters.";
  return null;
}

export const STATUS_TONE: Record<GymStatus, "neutral" | "good" | "warn" | "bad"> = {
  draft: "neutral", submitted: "warn", pending_review: "warn", approved: "good", rejected: "bad", suspended: "bad",
};
