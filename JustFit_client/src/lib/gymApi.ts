import { apiFetch, type ApiResult } from "@/lib/api";

// The gym admin portal's calls (JustFit_server/gym, mounted at /api/gym) and the Super Admin's
// Gyms (/api/admin/portal/gyms). The server reads the caller's role and gym on every request;
// nothing here decides which gym's data is shown.

// sale: a product (supplements, merchandise); pt: personal training; service: e.g. a steam bath
export type PaymentKind = "admission" | "renewal" | "due" | "pt" | "service" | "sale";
// How long a plan lasts: 1-24 months or 1-365 days
// A plan's length as it was saved. New plans are whole months only (day plans ended on
// 2026-11-07); "days" still arrives for members and catalogue items saved in days before that.
export type PlanUnit = "months" | "days";
export type PlanLength = { duration: number; unit: PlanUnit };
// What the forms send: the length in whole months (1-24)
export type PlanMonths = { duration: number };
// Plans / Catalogue: the branch's price list (plans and PT packages have a duration and unit;
// products may have a stock count, null when it isn't counted)
export type CatalogKind = "plan" | "pt" | "service" | "product";
// imageUrl: an optional picture or brochure photo, read with the session (null: none)
export type CatalogItem = { id: number; kind: CatalogKind; name: string; duration: number | null; unit: PlanUnit | null; price: number; stock: number | null; imageUrl: string | null };
export type PayMethod = "online" | "cash";
// receiptUrl: the bill attached to the payment (Add Member › Attach the payment bill), read with the
// session; the member's page carries it, the other payment lists don't
export type GymPayment = { id: number; kind: PaymentKind; title: string; detail: string; method: PayMethod; amount: number; paidOn: string; memberId: number | null; receiptUrl?: string | null };
// name: the gym (brand, e.g. Forma); branch: this branch (e.g. Tumkur), where the numbers come from
export type GymInfo = { name: string; branch: string; area: string; city: string };
// Invoices (2026-11-07): one payment's invoice, as the Invoice screen shows and shares it. billTo is
// null for a sale at the counter; membership and balance are the member's standing today.
export type InvoiceDetails = { address: string | null; phone: string | null; gstin: string | null };
export type GymInvoice = {
  number: string;
  date: string;
  gym: GymInfo & InvoiceDetails;
  billTo: { id: number; name: string; code: string; phone: string | null; email: string | null } | null;
  item: { kind: PaymentKind; label: string; detail: string; title: string };
  amount: number;
  method: PayMethod;
  paymentId: number;
  membership: { plan: string | null; until: string; active: boolean } | null;
  balance: { due: number; dueBy: string | null } | null;
};
export type GymBranch = { id: number; branch: string; area: string; city: string };
// access: owner (the gym admin, who may add a branch) or staff
export type GymBranches = { currentId: number; gym: string; access: "owner" | "staff"; branches: GymBranch[] };
// What the signed-in person is at the open branch: the gym admin (owner, linked by the justFit
// team) or Staff. Only the owner manages the team (Staff / Admin Login).
export type GymAccess = "owner" | "staff";
// Staff / Admin Login: the branch's team and its invites (numbers that haven't signed in yet).
// Phones arrive masked ("+91 ••••• ••210"); name is null until they've set up their profile.
export type StaffKind = "staff" | "trainer";
// Role & Permission: the portal's areas a Staff login can be given (the gym admin has all of them,
// a trainer none). Which routes each covers is the server's call (gym/staffRules.js).
export type StaffArea = "members" | "payments" | "enquiries" | "catalog" | "attendance" | "sms" | "predictions";
export type TeamMember = { id: string; name: string | null; phone: string | null; kind: "owner" | StaffKind; areas: StaffArea[]; addedAt: string | null; you: boolean };
export type StaffInvite = { id: number; phone: string | null; kind: StaffKind; invitedAt: string | null };
// branches: the branches of this gym the caller is the gym admin of (the Add sheet's Branch chips)
export type GymTeam = { gym: { id: number; name: string; branch: string }; branches: { id: number; branch: string }[]; team: TeamMember[]; invites: StaffInvite[] };

export type GymDashboard = {
  // areas: what the signed-in login may use at this branch (Role & Permission), so the app hides the rest
  gym: GymInfo & { branchCount: number; access: GymAccess; areas: StaffArea[] };
  today: string;
  revenue: { online: number; cash: number };
  stats: { admission: number; renewal: number; enquiry: number; duePaid: number; pt: number; product: number };
  // renewalRisk: members at High renewal risk (Predictions › Likely to leave)
  alerts: { dueMembers: number; expiringToday: number; attendance: number; expiringSoon: number; birthdays: number; renewalRisk: number; pauseRequests: number };
  recent: GymPayment[];
};

// Predictions (rules on the branch's own records, no AI). A member's renewal risk: the points that
// add up to the score, each with its reason; High 60+, Medium 35-59 (Low is never listed).
export type RiskLevel = "high" | "medium" | "low";
export type RiskListLevel = "all" | "high" | "medium" | "low";
export type RenewalRisk = { score: number; level: RiskLevel; reasons: { points: number; text: string }[]; lastVisit: string | null; visitsLast: number; visitsPrior: number };
export type RiskMember = GymMember & { risk: RenewalRisk };
export type RenewalRisks = { gym: GymInfo; today: string; calculatedAt: string; counts: { high: number; medium: number; low: number }; members: RiskMember[] };
// Payment on time (prediction #2): a member with a due and how likely they are to pay it late.
// unknown: nothing against them and no due payments on record yet
export type PayLevel = "late" | "watch" | "on_time" | "unknown";
export type PaymentRisk = { score: number; level: PayLevel; reasons: { points: number; text: string }[]; late: number; onTime: number };
export type DueMember = GymMember & { payment: PaymentRisk };
export type PaymentRisks = { gym: GymInfo; today: string; calculatedAt: string; counts: { late: number; watch: number }; members: DueMember[] };
// Busy hours: tomorrow's expected check-ins per hour, the average of the same weekday over the
// last four weeks the branch was recording (enough: at least two such weeks). hours run from
// 5 am to 10 pm, plus any earlier or later hour that had visits; expected is rounded.
// Month-end revenue: collected so far + plans ending this month × the branch's own renewal rate
// (last 90 days; null until 5 plan endings) × each member's last plan payment + eligible dues ×
// the due-collection rate (null without due history). A null part isn't guessed: complete is false.
export type RevenueForecast = {
  gym: GymInfo;
  today: string;
  calculatedAt: string;
  month: { from: string; to: string; daysLeft: number };
  collected: number;
  renewals: { expiring: number; priced: number; sample: { renewed: number; lapsed: number }; rate: number | null; amount: number | null };
  dues: { outstanding: number; sample: { paid: number; overdue: number }; rate: number | null; amount: number | null };
  expected: number;
  complete: boolean;
  lastMonth: number;
};
export type BusyHour = { hour: number; samples: number[]; expected: number };
export type BusyHours = {
  gym: GymInfo;
  today: string;
  calculatedAt: string;
  forDate: string;
  dates: string[];
  weeksUsed: number;
  enough: boolean;
  hours: BusyHour[];
  total: number;
  busiest: { hour: number; expected: number } | null;
  quietest: { hour: number; expected: number } | null;
  lastWeek: { date: string; total: number } | null;
};

export type MemberStatus = "active" | "expiring" | "expired";
export type Gender = "male" | "female" | "other";
// code: the member ID the server made (FOR-TUM-0001: gym, branch, number)
// dueBy: the date what they owe should be paid by; overdue once it has passed
export type MemberDetails = { email: string | null; heightCm: number | null; weightKg: number | null; address: string | null; notes: string | null };
// daysLeft: on the plan (0 on its last day, negative once ended); pt: the latest PT period
// trainer: who the PT is with (one of the branch's trainers from Staff / Admin Login), or null
export type MemberPt = { label: string; from: string; until: string; active: boolean; trainer: { id: string; name: string } | null };
// The branch's trainers, for the PT form's picker and Change trainer
export type GymTrainer = { id: string; name: string };
// Pause Membership: a member's open pause (pending from the app, or approved and not yet over)
export type PauseStatus = "pending" | "approved" | "rejected" | "cancelled";
export type MemberPause = { id: number; status: PauseStatus; by: "member" | "staff"; from: string; until: string; days: number; reason: string };
// A request or pause on the gym's list, with the member it belongs to; wouldEndOn: where the
// plan would end if a pending request is approved
export type PauseRequest = MemberPause & {
  note: string | null;
  extendedDays: number | null;
  requestedAt: string;
  decidedAt: string | null;
  member: { id: number; code: string; name: string; photoUrl: string | null; expiresOn: string; status: MemberStatus };
  wouldEndOn: string | null;
};
export type PauseView = "pending" | "all";
export type PauseList = { today: string; view: PauseView; counts: { pending: number }; pauses: PauseRequest[] };
export type PauseFields = { from: string; until: string; reason: string };
export type GymMember = MemberDetails & { id: number; code: string; photoUrl: string | null; dueBy: string | null; overdue: boolean; daysLeft: number; pt: MemberPt | null; gender: Gender | null; name: string; phone: string | null; dob: string | null; birthdayToday: boolean; planLength: PlanLength; joinedOn: string; expiresOn: string; due: number; status: MemberStatus; inToday: boolean; insideNow: boolean; pause: MemberPause | null; pausedNow: boolean };
// `gym` comes with GET /members/:id (the member's page needs it for messages); other answers leave it out
export type GymMemberDetail = { member: GymMember & { visitsThisMonth: number; lastVisit: string | null }; payments: GymPayment[]; gym?: GymInfo; alreadyIn?: boolean; durationMin?: number | null };
export type MemberFilter = "all" | "due" | "overdue" | "expiring" | "expiring_soon" | "expired" | "birthday";
export type MemberSort = "name" | "days" | "due";
// Enquiry follow-up: lost shows as "Not interested"; joined has the member they became
export type EnquiryStatus = "new" | "follow_up" | "joined" | "lost";
export type EnquiryInterest = "membership" | "pt" | "trial" | "other";
export type EnquirySource = "walk_in" | "call" | "whatsapp" | "instagram" | "referral" | "other";
export type EnquiryView = "today" | "overdue" | "open" | "joined" | "lost" | "all";
// A contact attempt with an enquiry and how it went (a visit is always visited)
export type ContactKind = "call" | "whatsapp" | "visit";
export type ContactOutcome = "reached" | "no_answer" | "visited";
export type EnquiryContact = { id: number; kind: ContactKind; outcome: ContactOutcome; on: string };
// The conversion score (Predictions #3): Hot 60+, Warm 30-59, Cold below; null once joined or lost
export type LeadLevel = "hot" | "warm" | "cold";
export type EnquiryLead = { score: number; level: LeadLevel; reasons: { points: number; text: string }[] };
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
  contacts: EnquiryContact[];
  lead: EnquiryLead | null;
};
export type EnquiryFields = { name: string; phone: string; note: string; interest: EnquiryInterest | ""; source: EnquirySource | ""; followUpOn: string | "" };
export type GymEnquiries = { today: string; enquiries: GymEnquiry[]; counts: Record<EnquiryView, number>; gym: GymInfo };
type Sums = { online: number; cash: number; total: number; byKind: Record<PaymentKind, number> };
export type GymWallet = { today: Sums; month: Sums; due: { total: number; members: number } };

// fee: the plan's price, which is what's payable (the server still accepts an optional
// admissionFee and discount; the sheet stopped sending them on 2026-11-07); paid is collected now
export type AdmissionFields = PlanMonths &
  Partial<{ [K in keyof MemberDetails]: MemberDetails[K] | "" }> & {
    name: string;
    phone: string;
    dob: string;
    gender: Gender | "";
    fee: number;
    admissionFee?: number;
    discount?: number;
    paid: number;
    method: PayMethod;
    dueBy: string;
    joinedOn: string;
    paidOn: string;
  };
export type RenewalFields = PlanMonths & { fee: number; paid: number; method: PayMethod; dueBy: string };
export type SaleCategory = "supplement" | "merchandise" | "other";
// Sell Product / Add Service from a member's ⋯: the server reads the price from the catalogue
export type MemberSaleFields = { itemId: number; quantity?: number; discount: number; paid: number; method: PayMethod; paidOn: string; dueBy?: string };

const signedOut = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again." });
const call = <T>(token: string | null, path: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET", body?: unknown): Promise<ApiResult<T>> =>
  token ? apiFetch<T>(path, { token, method, body }) : signedOut();

export const gymApi = {
  dashboard: (token: string | null) => call<GymDashboard>(token, "/api/gym/dashboard"),
  // `days` is how far ahead "expiring soon" looks (tomorrow to `days`, or "all" for every plan
  // still running); the counts use it too
  // 50 members a page, in the chosen order (the server sorts, so every page follows it); `nextPage`
  // is null on the last page
  members: (token: string | null, filter: MemberFilter, search: string, days: number | "all" = 3, sort: MemberSort = "name", page = 1) =>
    call<{ members: GymMember[]; counts: Record<MemberFilter, number>; gym: GymInfo; page: number; nextPage: number | null }>(
      token,
      `/api/gym/members?filter=${filter}&search=${encodeURIComponent(search)}&days=${days}&sort=${sort}&page=${page}`,
    ),
  nextCode: (token: string | null) => call<{ code: string }>(token, "/api/gym/members/next-code"),
  member: (token: string | null, id: number) => call<GymMemberDetail>(token, `/api/gym/members/${id}`),
  admit: (token: string | null, fields: AdmissionFields) => call<GymMemberDetail>(token, "/api/gym/members", "POST", fields),
  // A member's photo (base64 and its type; the server checks both from the bytes), answered with the member
  setPhoto: (token: string | null, memberId: number, photo: { data: string; mediaType: string }) => call<GymMemberDetail>(token, `/api/gym/members/${memberId}/photo`, "PUT", { data: photo.data, mediaType: photo.mediaType }),
  removePhoto: (token: string | null, memberId: number) => call<GymMemberDetail>(token, `/api/gym/members/${memberId}/photo`, "DELETE"),
  editMember: (token: string | null, id: number, fields: { name?: string; phone?: string; dob?: string; gender?: Gender | "" } & Partial<{ [K in keyof MemberDetails]: MemberDetails[K] | "" }>) => call<GymMemberDetail>(token, `/api/gym/members/${id}`, "PATCH", fields),
  renew: (token: string | null, id: number, fields: RenewalFields) => call<GymMemberDetail>(token, `/api/gym/members/${id}/renew`, "POST", fields),
  // Pause Membership: the requests, a decision on one, and a pause the staff record themselves
  pauses: (token: string | null, view: PauseView) => call<PauseList>(token, `/api/gym/pauses?view=${view}`),
  approvePause: (token: string | null, id: number, note?: string) => call<{ pause: PauseRequest }>(token, `/api/gym/pauses/${id}/approve`, "POST", note ? { note } : {}),
  rejectPause: (token: string | null, id: number, note?: string) => call<{ pause: PauseRequest }>(token, `/api/gym/pauses/${id}/reject`, "POST", note ? { note } : {}),
  pauseMember: (token: string | null, id: number, fields: PauseFields) => call<GymMemberDetail>(token, `/api/gym/members/${id}/pause`, "POST", fields),
  collectDue: (token: string | null, id: number, fields: { amount: number; method: PayMethod; dueBy?: string; paidOn?: string }) => call<GymMemberDetail>(token, `/api/gym/members/${id}/due`, "POST", fields),
  // trainerId: the trainer this PT is with, or null for none
  personalTraining: (token: string | null, id: number, fields: { package: string; amount: number; method: PayMethod; duration: number; startsOn?: string; endsOn?: string; trainerId: string | null }) => call<GymMemberDetail>(token, `/api/gym/members/${id}/pt`, "POST", fields),
  trainers: (token: string | null) => call<{ trainers: GymTrainer[] }>(token, "/api/gym/trainers"),
  setTrainer: (token: string | null, id: number, trainerId: string | null) => call<GymMemberDetail>(token, `/api/gym/members/${id}/trainer`, "POST", { trainerId }),
  sellToMember: (token: string | null, id: number, kind: "product" | "service", fields: MemberSaleFields) =>
    call<GymMemberDetail>(token, `/api/gym/members/${id}/${kind === "product" ? "sales" : "services"}`, "POST", fields),
  checkIn: (token: string | null, id: number) => call<GymMemberDetail>(token, `/api/gym/members/${id}/check-in`, "POST"),
  checkOut: (token: string | null, id: number) => call<GymMemberDetail>(token, `/api/gym/members/${id}/check-out`, "POST"),
  // `day` (YYYY-MM-DD) narrows the list to one day's payments
  payments: (token: string | null, query: { kind?: PaymentKind | null; before?: number | null; day?: string | null }) => {
    const params = [query.kind ? `kind=${query.kind}` : "", query.before ? `before=${query.before}` : "", query.day ? `day=${query.day}` : ""].filter(Boolean).join("&");
    return call<{ payments: GymPayment[]; nextBefore: number | null }>(token, `/api/gym/payments${params ? `?${params}` : ""}`);
  },
  service: (token: string | null, fields: { item: string; amount: number; method: PayMethod }) => call<{ payment: GymPayment }>(token, "/api/gym/services", "POST", fields),
  catalog: (token: string | null) => call<{ items: CatalogItem[] }>(token, "/api/gym/catalog"),
  addItem: (token: string | null, item: { kind: CatalogKind; name: string; duration?: number; price: number; stock?: number | "" }) => call<{ items: CatalogItem[] }>(token, "/api/gym/catalog", "POST", item),
  editItem: (token: string | null, id: number, fields: { name?: string; duration?: number; price?: number; stock?: number | "" }) => call<{ items: CatalogItem[] }>(token, `/api/gym/catalog/${id}`, "PATCH", fields),
  deleteItem: (token: string | null, id: number) => call<{ items: CatalogItem[] }>(token, `/api/gym/catalog/${id}`, "DELETE"),
  // An item's picture (base64 and its type; the server checks both from the bytes), answered with the catalogue
  setItemImage: (token: string | null, id: number, image: { data: string; mediaType: string }) => call<{ items: CatalogItem[] }>(token, `/api/gym/catalog/${id}/image`, "PUT", { data: image.data, mediaType: image.mediaType }),
  removeItemImage: (token: string | null, id: number) => call<{ items: CatalogItem[] }>(token, `/api/gym/catalog/${id}/image`, "DELETE"),
  // The bill attached to a payment: a photo of the receipt, checked again on the server from its bytes
  setReceipt: (token: string | null, paymentId: number, image: { data: string; mediaType: string }) => call<{ payment: GymPayment }>(token, `/api/gym/payments/${paymentId}/receipt`, "PUT", { data: image.data, mediaType: image.mediaType }),
  removeReceipt: (token: string | null, paymentId: number) => call<{ payment: GymPayment }>(token, `/api/gym/payments/${paymentId}/receipt`, "DELETE"),
  sale: (token: string | null, fields: { item: string; category: SaleCategory; amount: number; method: PayMethod }) => call<{ payment: GymPayment }>(token, "/api/gym/sales", "POST", fields),
  enquiries: (token: string | null, view: EnquiryView, search: string) =>
    call<GymEnquiries>(token, `/api/gym/enquiries?view=${view}&search=${encodeURIComponent(search)}`),
  addEnquiry: (token: string | null, fields: EnquiryFields) => call<{ enquiry: GymEnquiry }>(token, "/api/gym/enquiries", "POST", fields),
  editEnquiry: (token: string | null, id: number, fields: Partial<EnquiryFields> & { status?: EnquiryStatus; memberId?: number }) =>
    call<{ enquiry: GymEnquiry }>(token, `/api/gym/enquiries/${id}`, "PATCH", fields),
  addContact: (token: string | null, id: number, contact: { kind: ContactKind; outcome?: ContactOutcome }) =>
    call<{ enquiry: GymEnquiry }>(token, `/api/gym/enquiries/${id}/contacts`, "POST", contact),
  wallet: (token: string | null) => call<GymWallet>(token, "/api/gym/wallet"),
  updateDetails: (token: string | null, fields: Partial<Omit<GymInfo, "name">>) => call<{ gym: GymInfo }>(token, "/api/gym/details", "PATCH", fields),
  // Invoices: one payment's, or a member's latest payment's; the details printed on every invoice
  invoice: (token: string | null, paymentId: number) => call<GymInvoice>(token, `/api/gym/payments/${paymentId}/invoice`),
  memberInvoice: (token: string | null, memberId: number) => call<GymInvoice>(token, `/api/gym/members/${memberId}/invoice`),
  invoiceDetails: (token: string | null) => call<InvoiceDetails>(token, "/api/gym/invoice-details"),
  updateInvoiceDetails: (token: string | null, fields: Partial<Record<keyof InvoiceDetails, string>>) => call<InvoiceDetails>(token, "/api/gym/invoice-details", "PATCH", fields),
  branches: (token: string | null) => call<GymBranches>(token, "/api/gym/branches"),
  // The gym admin adds a branch of their gym (its name and location) and is linked to it
  addBranch: (token: string | null, fields: Omit<GymInfo, "name">) => call<GymBranches>(token, "/api/gym/branches", "POST", fields),
  switchBranch: (token: string | null, branchId: number) => call<GymBranches>(token, "/api/gym/branch", "POST", { branchId }),
  team: (token: string | null) => call<GymTeam>(token, "/api/gym/staff"),
  // added: linked now (their role changed); invited: they join at their first sign-in
  // branchId: the branch to add them to (one the caller manages); the answer names it as `branch`
  addStaff: (token: string | null, phone: string, kind: StaffKind, branchId: number) => call<GymTeam & { result: "added" | "invited"; branch: string }>(token, "/api/gym/staff", "POST", { phone, kind, branchId }),
  removeStaff: (token: string | null, userId: string) => call<GymTeam>(token, `/api/gym/staff/${encodeURIComponent(userId)}`, "DELETE"),
  // Role & Permission: the areas a Staff login may use at this branch (an empty list = Home only)
  setPermissions: (token: string | null, userId: string, areas: StaffArea[]) => call<GymTeam>(token, `/api/gym/staff/${encodeURIComponent(userId)}/permissions`, "PUT", { areas }),
  cancelInvite: (token: string | null, id: number) => call<GymTeam>(token, `/api/gym/staff/invites/${id}`, "DELETE"),
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
  renewalRisks: (token: string | null, level: RiskListLevel, search: string) =>
    call<RenewalRisks>(token, `/api/gym/predictions/renewals?level=${level}&search=${encodeURIComponent(search)}`),
  paymentRisks: (token: string | null, search: string) => call<PaymentRisks>(token, `/api/gym/predictions/payments?search=${encodeURIComponent(search)}`),
  busyHours: (token: string | null) => call<BusyHours>(token, "/api/gym/predictions/busy-hours"),
  revenueForecast: (token: string | null) => call<RevenueForecast>(token, "/api/gym/predictions/revenue"),
};

// ---- QR attendance ------------------------------------------------------------------------

// inside: checked in, not out yet (always today's); no_checkout: still open at midnight, India time
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
  // today, the last 7 days and the last 30 days
  stats: { today: VisitStats; week: VisitStats; month: VisitStats };
  // The Statistics chart for each period: today by hour (India time), the others one bar a day
  charts: { today: HourBar[]; week: DayBar[]; month: DayBar[] };
  lastSevenDays: DayBar[];
};
export type DayBar = { day: string; visits: number };
export type HourBar = { hour: number; visits: number };
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
