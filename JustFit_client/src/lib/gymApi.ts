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
export type GymMember = MemberDetails & { id: number; code: string; dueBy: string | null; overdue: boolean; daysLeft: number; pt: MemberPt | null; gender: Gender | null; name: string; phone: string | null; dob: string | null; birthdayToday: boolean; planLength: PlanLength; joinedOn: string; expiresOn: string; due: number; status: MemberStatus; inToday: boolean };
export type GymMemberDetail = { member: GymMember & { visitsThisMonth: number; lastVisit: string | null }; payments: GymPayment[]; alreadyIn?: boolean };
export type MemberFilter = "all" | "due" | "overdue" | "expiring" | "expiring_soon" | "expired" | "in_today" | "birthday";
export type GymEnquiry = { id: number; name: string; phone: string | null; note: string | null; enquiredOn: string };
type Sums = { online: number; cash: number; total: number; byKind: Record<PaymentKind, number> };
export type GymWallet = { today: Sums; month: Sums; owed: { total: number; members: number } };

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
const call = <T>(token: string | null, path: string, method: "GET" | "POST" | "PATCH" | "DELETE" = "GET", body?: unknown): Promise<ApiResult<T>> =>
  token ? apiFetch<T>(path, { token, method, body }) : signedOut();

export const gymApi = {
  dashboard: (token: string | null) => call<GymDashboard>(token, "/api/gym/dashboard"),
  members: (token: string | null, filter: MemberFilter, search: string) =>
    call<{ members: GymMember[] }>(token, `/api/gym/members?filter=${filter}&search=${encodeURIComponent(search)}`),
  nextCode: (token: string | null) => call<{ code: string }>(token, "/api/gym/members/next-code"),
  member: (token: string | null, id: number) => call<GymMemberDetail>(token, `/api/gym/members/${id}`),
  admit: (token: string | null, fields: AdmissionFields) => call<GymMemberDetail>(token, "/api/gym/members", "POST", fields),
  editMember: (token: string | null, id: number, fields: { name?: string; phone?: string; dob?: string; gender?: Gender | "" } & Partial<{ [K in keyof MemberDetails]: MemberDetails[K] | "" }>) => call<GymMemberDetail>(token, `/api/gym/members/${id}`, "PATCH", fields),
  renew: (token: string | null, id: number, fields: RenewalFields) => call<GymMemberDetail>(token, `/api/gym/members/${id}/renew`, "POST", fields),
  collectDue: (token: string | null, id: number, fields: { amount: number; method: PayMethod; dueBy?: string; paidOn?: string }) => call<GymMemberDetail>(token, `/api/gym/members/${id}/due`, "POST", fields),
  personalTraining: (token: string | null, id: number, fields: { package: string; amount: number; method: PayMethod; unit: PlanUnit; duration: number }) => call<GymMemberDetail>(token, `/api/gym/members/${id}/pt`, "POST", fields),
  sellToMember: (token: string | null, id: number, kind: "product" | "service", fields: MemberSaleFields) =>
    call<GymMemberDetail>(token, `/api/gym/members/${id}/${kind === "product" ? "sales" : "services"}`, "POST", fields),
  checkIn: (token: string | null, id: number) => call<GymMemberDetail>(token, `/api/gym/members/${id}/check-in`, "POST"),
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
  enquiries: (token: string | null) => call<{ enquiries: GymEnquiry[] }>(token, "/api/gym/enquiries"),
  addEnquiry: (token: string | null, fields: { name: string; phone: string; note: string }) => call<{ enquiry: GymEnquiry }>(token, "/api/gym/enquiries", "POST", fields),
  wallet: (token: string | null) => call<GymWallet>(token, "/api/gym/wallet"),
  updateDetails: (token: string | null, fields: Partial<Omit<GymInfo, "name">> & { adminName?: string }) =>
    call<{ gym: GymInfo; adminName: string | null }>(token, "/api/gym/details", "PATCH", fields),
  branches: (token: string | null) => call<GymBranches>(token, "/api/gym/branches"),
  switchBranch: (token: string | null, branchId: number) => call<GymBranches>(token, "/api/gym/branch", "POST", { branchId }),
};

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
};

export const adminGyms = {
  list: (token: string | null) => call<{ gyms: AdminGymRow[] }>(token, "/api/admin/portal/gyms"),
  detail: (token: string | null, id: number) => call<AdminGymDetail>(token, `/api/admin/portal/gyms/${id}`),
  create: (token: string | null, fields: GymInfo) => call<AdminGymDetail>(token, "/api/admin/portal/gyms", "POST", fields),
  addBranch: (token: string | null, id: number, fields: Omit<GymInfo, "name">) => call<AdminGymDetail>(token, `/api/admin/portal/gyms/${id}/branches`, "POST", fields),
  update: (token: string | null, id: number, fields: Partial<GymInfo>) => call<AdminGymDetail>(token, `/api/admin/portal/gyms/${id}`, "PATCH", fields),
  linkStaff: (token: string | null, id: number, phone: string) => call<AdminGymDetail>(token, `/api/admin/portal/gyms/${id}/staff`, "POST", { phone }),
  unlinkStaff: (token: string | null, id: number, userId: string) => call<AdminGymDetail>(token, `/api/admin/portal/gyms/${id}/staff/${encodeURIComponent(userId)}`, "DELETE"),
};
