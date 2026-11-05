import { apiFetch, type ApiResult } from "@/lib/api";

// The gym admin portal's calls (JustFit_server/gym, mounted at /api/gym) and the Super Admin's
// Gyms (/api/admin/portal/gyms). The server reads the caller's role and gym on every request;
// nothing here decides which gym's data is shown.

// sale: a product (supplements, merchandise); pt: personal training; service: e.g. a steam bath
export type PaymentKind = "admission" | "renewal" | "due" | "pt" | "service" | "sale";
// How long a plan lasts: 1-24 months or 1-365 days
export type PlanUnit = "months" | "days";
export type PlanLength = { duration: number; unit: PlanUnit };
// Plans / Catalogue: the branch's price list (plans and PT packages have a duration and unit;
// products may have a stock count, null when it isn't counted)
export type CatalogKind = "plan" | "pt" | "service" | "product";
export type CatalogItem = { id: number; kind: CatalogKind; name: string; duration: number | null; unit: PlanUnit | null; price: number; stock: number | null };
export type PayMethod = "online" | "cash";
export type GymPayment = { id: number; kind: PaymentKind; title: string; detail: string; method: PayMethod; amount: number; paidOn: string; memberId: number | null };
// name: the gym (brand, e.g. Forma); branch: this branch (e.g. Tumkur), where the numbers come from
export type GymInfo = { name: string; branch: string; area: string; city: string };
export type GymBranch = { id: number; branch: string; area: string; city: string };
export type GymBranches = { currentId: number; gym: string; branches: GymBranch[] };

export type GymDashboard = {
  gym: GymInfo & { branchCount: number };
  today: string;
  revenue: { online: number; cash: number };
  stats: { admission: number; renewal: number; enquiry: number; duePaid: number; pt: number; product: number };
  alerts: { dueMembers: number; expiringToday: number; attendance: number; expiringSoon: number; birthdays: number };
  recent: GymPayment[];
};

export type MemberStatus = "active" | "expiring" | "expired";
export type Gender = "male" | "female" | "other";
// code: the member ID the server made (FOR-TUM-0001: gym, branch, number)
// dueBy: the date what they owe should be paid by; overdue once it has passed
export type MemberDetails = { email: string | null; heightCm: number | null; weightKg: number | null; address: string | null; notes: string | null };
// daysLeft: on the plan (0 on its last day, negative once ended); pt: the latest PT period
export type MemberPt = { label: string; from: string; until: string; active: boolean };
export type GymMember = MemberDetails & { id: number; code: string; photoUrl: string | null; dueBy: string | null; overdue: boolean; daysLeft: number; pt: MemberPt | null; gender: Gender | null; name: string; phone: string | null; dob: string | null; birthdayToday: boolean; planLength: PlanLength; joinedOn: string; expiresOn: string; due: number; status: MemberStatus; inToday: boolean; insideNow: boolean };
export type GymMemberDetail = { member: GymMember & { visitsThisMonth: number; lastVisit: string | null }; payments: GymPayment[]; alreadyIn?: boolean; durationMin?: number | null };
export type MemberFilter = "all" | "due" | "overdue" | "expiring" | "expiring_soon" | "expired" | "in_today" | "birthday";
// Enquiry follow-up: lost shows as "Not interested"; joined has the member they became
export type EnquiryStatus = "new" | "follow_up" | "joined" | "lost";
export type EnquiryInterest = "membership" | "pt" | "trial" | "other";
export type EnquirySource = "walk_in" | "call" | "whatsapp" | "instagram" | "referral" | "other";
export type EnquiryView = "today" | "overdue" | "open" | "joined" | "lost" | "all";
export type GymEnquiry = {
  id: number;
  name: string;
  phone: string | null;
  note: string | null;
  status: EnquiryStatus;
  followUpOn: string | null;
  interest: EnquiryInterest | null;
  source: EnquirySource | null;
  member: { id: number; code: string } | null;
  enquiredOn: string;
};
export type EnquiryFields = { name: string; phone: string; note: string; interest: EnquiryInterest | ""; source: EnquirySource | ""; followUpOn: string | "" };
export type GymEnquiries = { today: string; enquiries: GymEnquiry[]; counts: Record<EnquiryView, number>; gym: GymInfo };
type Sums = { online: number; cash: number; total: number; byKind: Record<PaymentKind, number> };
export type GymWallet = { today: Sums; month: Sums; due: { total: number; members: number } };

// fee: the plan's price; admissionFee and discount change what's payable; paid is collected now
export type AdmissionFields = PlanLength &
  Partial<{ [K in keyof MemberDetails]: MemberDetails[K] | "" }> & {
    name: string;
    phone: string;
    dob: string;
    gender: Gender | "";
    fee: number;
    admissionFee: number;
    discount: number;
    paid: number;
    method: PayMethod;
    dueBy: string;
    joinedOn: string;
    paidOn: string;
  };
export type RenewalFields = PlanLength & { fee: number; paid: number; method: PayMethod; dueBy: string };
export type SaleCategory = "supplement" | "merchandise" | "other";
// Sell Product / Add Service from a member's ⋯: the server reads the price from the catalogue
export type MemberSaleFields = { itemId: number; quantity?: number; discount: number; paid: number; method: PayMethod; paidOn: string; dueBy?: string };

const signedOut = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again." });
const call = <T>(token: string | null, path: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET", body?: unknown): Promise<ApiResult<T>> =>
  token ? apiFetch<T>(path, { token, method, body }) : signedOut();

export const gymApi = {
  dashboard: (token: string | null) => call<GymDashboard>(token, "/api/gym/dashboard"),
  members: (token: string | null, filter: MemberFilter, search: string) =>
    call<{ members: GymMember[]; gym: GymInfo }>(token, `/api/gym/members?filter=${filter}&search=${encodeURIComponent(search)}`),
  nextCode: (token: string | null) => call<{ code: string }>(token, "/api/gym/members/next-code"),
  member: (token: string | null, id: number) => call<GymMemberDetail>(token, `/api/gym/members/${id}`),
  admit: (token: string | null, fields: AdmissionFields) => call<GymMemberDetail>(token, "/api/gym/members", "POST", fields),
  // A member's photo (base64 and its type; the server checks both from the bytes), answered with the member
  setPhoto: (token: string | null, memberId: number, photo: { data: string; mediaType: string }) => call<GymMemberDetail>(token, `/api/gym/members/${memberId}/photo`, "PUT", { data: photo.data, mediaType: photo.mediaType }),
  editMember: (token: string | null, id: number, fields: { name?: string; phone?: string; dob?: string; gender?: Gender | "" } & Partial<{ [K in keyof MemberDetails]: MemberDetails[K] | "" }>) => call<GymMemberDetail>(token, `/api/gym/members/${id}`, "PATCH", fields),
  renew: (token: string | null, id: number, fields: RenewalFields) => call<GymMemberDetail>(token, `/api/gym/members/${id}/renew`, "POST", fields),
  collectDue: (token: string | null, id: number, fields: { amount: number; method: PayMethod; dueBy?: string; paidOn?: string }) => call<GymMemberDetail>(token, `/api/gym/members/${id}/due`, "POST", fields),
  personalTraining: (token: string | null, id: number, fields: { package: string; amount: number; method: PayMethod; unit: PlanUnit; duration: number }) => call<GymMemberDetail>(token, `/api/gym/members/${id}/pt`, "POST", fields),
  sellToMember: (token: string | null, id: number, kind: "product" | "service", fields: MemberSaleFields) =>
    call<GymMemberDetail>(token, `/api/gym/members/${id}/${kind === "product" ? "sales" : "services"}`, "POST", fields),
  checkIn: (token: string | null, id: number) => call<GymMemberDetail>(token, `/api/gym/members/${id}/check-in`, "POST"),
  checkOut: (token: string | null, id: number) => call<GymMemberDetail>(token, `/api/gym/members/${id}/check-out`, "POST"),
  payments: (token: string | null, query: { kind?: PaymentKind | null; before?: number | null; today?: boolean }) => {
    const params = [query.kind ? `kind=${query.kind}` : "", query.before ? `before=${query.before}` : "", query.today ? "today=1" : ""].filter(Boolean).join("&");
    return call<{ payments: GymPayment[]; nextBefore: number | null }>(token, `/api/gym/payments${params ? `?${params}` : ""}`);
  },
  service: (token: string | null, fields: { item: string; amount: number; method: PayMethod }) => call<{ payment: GymPayment }>(token, "/api/gym/services", "POST", fields),
  catalog: (token: string | null) => call<{ items: CatalogItem[] }>(token, "/api/gym/catalog"),
  addItem: (token: string | null, item: { kind: CatalogKind; name: string; duration?: number; unit?: PlanUnit; price: number; stock?: number | "" }) => call<{ items: CatalogItem[] }>(token, "/api/gym/catalog", "POST", item),
  editItem: (token: string | null, id: number, fields: { name?: string; duration?: number; unit?: PlanUnit; price?: number; stock?: number | "" }) => call<{ items: CatalogItem[] }>(token, `/api/gym/catalog/${id}`, "PATCH", fields),
  deleteItem: (token: string | null, id: number) => call<{ items: CatalogItem[] }>(token, `/api/gym/catalog/${id}`, "DELETE"),
  sale: (token: string | null, fields: { item: string; category: SaleCategory; amount: number; method: PayMethod }) => call<{ payment: GymPayment }>(token, "/api/gym/sales", "POST", fields),
  enquiries: (token: string | null, view: EnquiryView, search: string) =>
    call<GymEnquiries>(token, `/api/gym/enquiries?view=${view}&search=${encodeURIComponent(search)}`),
  addEnquiry: (token: string | null, fields: EnquiryFields) => call<{ enquiry: GymEnquiry }>(token, "/api/gym/enquiries", "POST", fields),
  editEnquiry: (token: string | null, id: number, fields: Partial<EnquiryFields> & { status?: EnquiryStatus; memberId?: number }) =>
    call<{ enquiry: GymEnquiry }>(token, `/api/gym/enquiries/${id}`, "PATCH", fields),
  wallet: (token: string | null) => call<GymWallet>(token, "/api/gym/wallet"),
  updateDetails: (token: string | null, fields: Partial<Omit<GymInfo, "name">> & { adminName?: string }) =>
    call<{ gym: GymInfo; adminName: string | null }>(token, "/api/gym/details", "PATCH", fields),
  branches: (token: string | null) => call<GymBranches>(token, "/api/gym/branches"),
  switchBranch: (token: string | null, branchId: number) => call<GymBranches>(token, "/api/gym/branch", "POST", { branchId }),
  sms: (token: string | null) => call<GymSms>(token, "/api/gym/sms"),
  smsSettings: (token: string | null, changes: Partial<Record<SmsKind, boolean>>) => call<GymSms>(token, "/api/gym/sms/settings", "PATCH", changes),
  smsSend: (token: string | null, group: SmsGroupId) => call<SmsSendResult>(token, "/api/gym/sms/send", "POST", { group }),
  memberSms: (token: string | null, id: number, kind: SmsKind) => call<{ sent: number; credits: number }>(token, `/api/gym/members/${id}/sms`, "POST", { kind }),
  attendance: (token: string | null) => call<AttendanceSummary>(token, "/api/gym/attendance"),
  visits: (token: string | null, query: VisitQuery) => call<VisitPage>(token, `/api/gym/attendance/visits?${visitParams(query)}`),
  attendanceSettings: (token: string | null) => call<AttendanceSettings>(token, "/api/gym/attendance/settings"),
  saveAttendancePlace: (token: string | null, place: { latitude: number; longitude: number; radiusM: number }) => call<AttendanceSettings>(token, "/api/gym/attendance/location", "PUT", place),
  regenerateQr: (token: string | null) => call<AttendanceSettings>(token, "/api/gym/attendance/qr", "POST"),
  smsLogs: (token: string | null, before: number | null) => call<{ logs: SmsLog[]; next: number | null }>(token, `/api/gym/sms/logs${before ? `?before=${before}` : ""}`),
};

// ---- QR attendance ------------------------------------------------------------------------

// inside: checked in, not out yet; no_checkout: left open for 12 hours
export type VisitStatus = "inside" | "completed" | "no_checkout";
// durationMin: so far while inside; null when never checked out. Times are ISO instants.
export type GymVisit = {
  id: number;
  memberId: number;
  memberCode: string;
  memberName: string;
  photoUrl: string | null;
  date: string;
  checkedInAt: string;
  checkedOutAt: string | null;
  durationMin: number | null;
  status: VisitStatus;
  inSource: "qr" | "staff";
  outSource: "qr" | "staff" | null;
  checkInDistanceM: number | null;
};
export type VisitStats = { visits: number; members: number; completed: number; avgMinutes: number | null };
export type AttendanceSummary = {
  gym: GymInfo;
  today: string;
  setup: { location: boolean; qr: boolean };
  insideNow: number;
  inside: GymVisit[];
  stats: { today: VisitStats; week: VisitStats; month: VisitStats };
  lastSevenDays: { day: string; visits: number }[];
};
export type VisitQuery = { from: string; to: string; status: VisitStatus | "all"; search: string; memberId?: number; page?: number };
export type VisitPage = { visits: GymVisit[]; total: number; page: number; pageSize: number; from: string; to: string };
// qr.payload: the text the QR code carries (the branch and a signature; no member data)
export type AttendanceSettings = {
  gym: GymInfo;
  location: { latitude: number; longitude: number } | null;
  radiusM: number;
  radiusLimits: { min: number; max: number };
  qr: { payload: string; version: number; madeAt: string } | null;
};

export const visitParams = (q: VisitQuery) =>
  [
    `from=${q.from}`,
    `to=${q.to}`,
    q.status !== "all" ? `status=${q.status}` : "",
    q.search.trim() ? `search=${encodeURIComponent(q.search.trim())}` : "",
    q.memberId ? `memberId=${q.memberId}` : "",
    q.page && q.page > 1 ? `page=${q.page}` : "",
  ].filter(Boolean).join("&");

// ---- Send Bulk SMS (1 credit = 1 SMS; credits are added by the justFit team) -------------------

export type SmsKind = "expiry" | "expired" | "due" | "birthday";
export type SmsGroupId = "expiring" | "expired" | "due" | "birthday";
// sending: whether the server can send SMS (false: the app opens the phone's own SMS app instead)
export type GymSms = {
  credits: number;
  sending: boolean;
  reminders: { kind: SmsKind; title: string; when: string; on: boolean; preview: string }[];
  groups: { id: SmsGroupId; label: string; kind: SmsKind; count: number }[];
};
// skipped: not sent because the credits ran out
export type SmsSendResult = { sent: number; failed: number; skipped: number; credits: number };
export type SmsLog = { id: number; name: string; code: string; kind: SmsKind; source: "auto" | "manual"; status: "sending" | "sent" | "failed"; text: string; at: string };

// ---- Super Admin › Gyms -------------------------------------------------------------------

export type AdminGymRow = GymInfo & { id: number; brandId: number; createdAt: string | null; staff: number; members: number; active: number; revenueToday: number; attendanceToday: number };
export type AdminGymDetail = {
  gym: GymInfo & { id: number; brandId: number; createdAt: string | null };
  // Every branch of this gym, this one included
  branches: { id: number; branch: string }[];
  stats: {
    todayOnline: number;
    todayCash: number;
    monthRevenue: number;
    monthAdmissions: number;
    monthRenewals: number;
    members: number;
    active: number;
    dueMembers: number;
    dueTotal: number;
    attendanceToday: number;
    enquiriesMonth: number;
  };
  staff: { id: string; name: string; phone: string | null }[];
  recent: GymPayment[];
  // SMS this branch can still send (null before the SMS migration has run)
  smsCredits: number | null;
};

export const adminGyms = {
  list: (token: string | null) => call<{ gyms: AdminGymRow[] }>(token, "/api/admin/portal/gyms"),
  detail: (token: string | null, id: number) => call<AdminGymDetail>(token, `/api/admin/portal/gyms/${id}`),
  create: (token: string | null, fields: GymInfo) => call<AdminGymDetail>(token, "/api/admin/portal/gyms", "POST", fields),
  addBranch: (token: string | null, id: number, fields: Omit<GymInfo, "name">) => call<AdminGymDetail>(token, `/api/admin/portal/gyms/${id}/branches`, "POST", fields),
  update: (token: string | null, id: number, fields: Partial<GymInfo>) => call<AdminGymDetail>(token, `/api/admin/portal/gyms/${id}`, "PATCH", fields),
  linkStaff: (token: string | null, id: number, phone: string) => call<AdminGymDetail>(token, `/api/admin/portal/gyms/${id}/staff`, "POST", { phone }),
  addSmsCredits: (token: string | null, id: number, credits: number) => call<AdminGymDetail>(token, `/api/admin/portal/gyms/${id}/sms-credits`, "POST", { credits }),
  unlinkStaff: (token: string | null, id: number, userId: string) => call<AdminGymDetail>(token, `/api/admin/portal/gyms/${id}/staff/${encodeURIComponent(userId)}`, "DELETE"),
};
