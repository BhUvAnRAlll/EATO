import type { ImageSource } from "expo-image";

import { apiFetch, getApiUrl, type ApiResult } from "@/lib/api";
import { resolveImage } from "@/lib/home";
import type { Diet, MealSlot, OrderStatus, Tag } from "@/lib/mealRules";

// Meal ordering (JustFit_server/meals/): the menu and a member's orders under /api/meals and
// /api/orders, and the Super Admin's kitchen under /api/admin/kitchen. The server decides who may
// do what, the prices, which meal times are open and every step; nothing here is trusted.

export type MealTag = Tag;
export type MenuMeal = {
  id: string;
  name: string;
  description: string | null;
  servingSize: string | null;
  ingredients: string | null;
  diet: Diet;
  tags: MealTag[];
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  price: number; // whole rupees
  mrp: number | null; // the price before a discount, when there is one
  imageUrl: string | null;
  favorite?: boolean;
};
export type AdminMeal = MenuMeal & { openOrders: number; available: boolean };

// The storefront (GET /api/meals/storefront): what the Meals tab shows, in one read
export type MealCategory = {
  id: number;
  kind: "tile" | "food";
  name: string;
  subtitle: string | null;
  badge: string | null;
  imageUrl: string | null;
  matchTag: MealTag | null;
  maxPrice: number | null;
  featured: boolean;
  sortOrder: number;
  mealIds: string[];
};
export type BannerTarget = { kind: "category" | "meal" | "tag"; ref: string };
export type MealBanner = { id: number; title: string; description: string | null; badge: string | null; ctaLabel: string; target: BannerTarget; imageUrl: string | null; endsOn: string | null };
export type Coupon = {
  id: number;
  code: string;
  title: string;
  kind: "percent" | "flat";
  percentOff: number | null;
  flatOff: number | null;
  maxDiscount: number | null;
  minOrder: number;
  perMemberLimit: number;
  startsOn: string | null;
  endsOn: string | null;
  active: boolean;
  state: "live" | "scheduled" | "expired" | "off";
  off: string; // "50% off up to ₹100"
  above: string | null; // "Above ₹149"
  usesLeft?: number;
  uses?: number;
};
export type Storefront = { today: string; meals: MenuMeal[]; categories: MealCategory[]; banners: MealBanner[]; coupons: Coupon[] };
export type Quote = { subtotal: number; discount: number; total: number; unavailable: string[]; coupon: { code: string; ok: boolean; problem: string | null; title: string | null } | null };

// What the admin sends (amounts in whole rupees; `photo` adds or replaces, `removePhoto` takes it away)
export type Photo = { data: string; mediaType: string };
export type MealInput = {
  name: string; description: string; diet: Diet; calories: number; proteinG: number; carbsG: number; fatG: number; price: number;
  mrp: number | null; tags: MealTag[]; servingSize: string; ingredients: string; available: boolean; photo?: Photo; removePhoto?: true;
};
export type CategoryInput = {
  kind: "tile" | "food"; name: string; subtitle: string; badge: string; matchTag: MealTag | null; maxPrice: number | null; mealIds: string[];
  featured: boolean; active: boolean; sortOrder: number; photo?: Photo; removePhoto?: true;
};
export type AdminCategory = Omit<MealCategory, "mealIds"> & { active: boolean; mealIds: string[] };
export type BannerInput = {
  title: string; description: string; badge: string; ctaLabel: string; target: BannerTarget; startsOn: string | null; endsOn: string | null;
  active: boolean; sortOrder: number; photo?: Photo; removePhoto?: true;
};
export type AdminBanner = MealBanner & { startsOn: string | null; active: boolean; sortOrder: number; live: boolean };
export type CouponInput = {
  code: string; title: string; kind: "percent" | "flat"; percentOff: number | null; flatOff: number | null; maxDiscount: number | null;
  minOrder: number; perMemberLimit: number; startsOn: string | null; endsOn: string | null; active: boolean;
};

export type SlotTimes = { startsAt: string; endsAt: string; active: boolean };
export type Slots = Record<MealSlot, SlotTimes>;
export type OrderDay = { date: string; slots: { slot: MealSlot; open: boolean; closesAt: string }[] };
export type OrderOptions = { slots: Slots; days: OrderDay[]; cutoffMinutes: number; maxQuantity: number };

export type OrderItem = { mealId: string | null; name: string; quantity: number; price: number; calories: number; proteinG: number; carbsG: number; fatG: number; imageUrl: string | null };
export type Order = {
  id: string;
  code: string;
  date: string;
  slot: MealSlot;
  slotStartsAt: string | null;
  slotEndsAt: string | null;
  status: OrderStatus;
  total: number;
  subtotal: number;
  discount: number;
  couponCode: string | null;
  payment: { method: "test" | "dummy" | "razorpay"; ref: string | null } | null;
  address: { receiverName: string | null; receiverPhone: string | null; line: string | null; pincode: string; latitude: number | null; longitude: number | null; instructions: string | null };
  cancelReason: string | null;
  cancelledBy: "member" | "admin" | "system" | null;
  deliveredAt: string | null;
  createdAt: string;
  items: OrderItem[];
  totals: { calories: number; proteinG: number; carbsG: number; fatG: number };
  memberName?: string | null;
};
export type CartItem = { mealId: string; quantity: number };
// What Pay answers while the order waits for payment: Razorpay's checkout options (nothing secret)
export type CheckoutOptions = {
  provider: "dummy" | "razorpay";
  key: string;
  order_id: string;
  amount: number; // paise
  currency: string;
  name: string;
  description: string;
  prefill: { contact: string | null; name: string | null };
  theme: { color: string };
};
// What a successful checkout hands back, as Razorpay names it
export type PaymentSuccess = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
export type PaymentMethod = "upi" | "card" | "netbanking" | "wallet";
export type NewOrder = { clientId: string; addressId: number; date: string; slot: MealSlot; items: CartItem[]; couponCode?: string };

const signedOut = <T,>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again.", status: 401 });
const call = <T,>(token: string | null, path: string, options: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown } = {}): Promise<ApiResult<T>> =>
  token ? apiFetch<T>(path, { ...options, token }) : signedOut<T>();

/**
 * A meal's picture for expo-image: an uploaded photo is read from the server with the session
 * token (never public); a bundled or https picture as Home shows it.
 */
export function mealImage(imageUrl: string | null | undefined, token: string | null): number | ImageSource {
  if (imageUrl?.startsWith("/api/")) {
    return token ? { uri: `${getApiUrl()}${imageUrl}`, headers: { Authorization: `Bearer ${token}` }, cacheKey: imageUrl } : resolveImage(null);
  }
  return resolveImage(imageUrl);
}

export const mealsApi = {
  menu: (token: string | null, query: { search?: string; diet?: Diet | null } = {}) => {
    const params = new URLSearchParams();
    if (query.search?.trim()) params.set("search", query.search.trim());
    if (query.diet) params.set("diet", query.diet);
    const qs = params.toString();
    return call<{ meals: MenuMeal[] }>(token, `/api/meals${qs ? `?${qs}` : ""}`);
  },
  meal: (token: string | null, id: string) => call<{ meal: MenuMeal }>(token, `/api/meals/${encodeURIComponent(id)}`),
  favorite: (token: string | null, id: string, on: boolean) =>
    call<{ mealId: string; favorite: boolean }>(token, `/api/meals/${encodeURIComponent(id)}/favorite`, { method: on ? "PUT" : "DELETE" }),
  storefront: (token: string | null) => call<Storefront>(token, "/api/meals/storefront"),
  options: (token: string | null) => call<OrderOptions>(token, "/api/orders/options"),
  quote: (token: string | null, items: CartItem[], couponCode?: string) => call<Quote>(token, "/api/orders/quote", { method: "POST", body: { items, ...(couponCode ? { couponCode } : {}) } }),
  place: (token: string | null, order: NewOrder) => call<{ order: Order; checkout: CheckoutOptions | null; repeated: boolean }>(token, "/api/orders", { method: "POST", body: order }),
  // The server checks the signature, then the order is placed
  verifyPayment: (token: string | null, id: string, paid: PaymentSuccess) =>
    call<{ order: Order; alreadyPaid: boolean }>(token, `/api/orders/${encodeURIComponent(id)}/verify-payment`, { method: "POST", body: paid }),
  paymentFailed: (token: string | null, id: string, providerOrderId: string, reason: string) =>
    call<{ recorded: boolean }>(token, `/api/orders/${encodeURIComponent(id)}/payment-failed`, { method: "POST", body: { razorpay_order_id: providerOrderId, reason } }),
  // The dummy gateway (stands in for Razorpay's servers; no money moves)
  dummyCheckout: (token: string | null, providerOrderId: string, method: PaymentMethod, outcome: "success" | "failure") =>
    call<({ status: "captured" } & PaymentSuccess) | { status: "failed"; error: { code: string; description: string; reason: string } }>(token, "/api/orders/gateway/dummy/checkout", {
      method: "POST",
      body: { razorpay_order_id: providerOrderId, method, outcome },
    }),
  orders: (token: string | null) => call<{ orders: Order[] }>(token, "/api/orders"),
  order: (token: string | null, id: string) => call<{ order: Order }>(token, `/api/orders/${encodeURIComponent(id)}`),
  cancel: (token: string | null, id: string) => call<{ order: Order }>(token, `/api/orders/${encodeURIComponent(id)}/cancel`, { method: "POST", body: {} }),
};

export const kitchenApi = {
  meals: (token: string | null) => call<{ meals: AdminMeal[] }>(token, "/api/admin/kitchen/meals"),
  addMeal: (token: string | null, meal: MealInput) => call<{ meal: AdminMeal }>(token, "/api/admin/kitchen/meals", { method: "POST", body: meal }),
  editMeal: (token: string | null, id: string, meal: MealInput) => call<{ meal: AdminMeal }>(token, `/api/admin/kitchen/meals/${encodeURIComponent(id)}`, { method: "PUT", body: meal }),
  setVisible: (token: string | null, id: string, available: boolean) =>
    call<{ meal: AdminMeal }>(token, `/api/admin/kitchen/meals/${encodeURIComponent(id)}/visibility`, { method: "PATCH", body: { available } }),
  categories: (token: string | null) => call<{ categories: AdminCategory[] }>(token, "/api/admin/kitchen/categories"),
  saveCategory: (token: string | null, id: number | null, input: CategoryInput) =>
    call<{ category: AdminCategory }>(token, id ? `/api/admin/kitchen/categories/${id}` : "/api/admin/kitchen/categories", { method: id ? "PUT" : "POST", body: input }),
  banners: (token: string | null) => call<{ banners: AdminBanner[] }>(token, "/api/admin/kitchen/banners"),
  saveBanner: (token: string | null, id: number | null, input: BannerInput) =>
    call<{ banner: AdminBanner }>(token, id ? `/api/admin/kitchen/banners/${id}` : "/api/admin/kitchen/banners", { method: id ? "PUT" : "POST", body: input }),
  coupons: (token: string | null) => call<{ coupons: Coupon[] }>(token, "/api/admin/kitchen/coupons"),
  saveCoupon: (token: string | null, id: number | null, input: CouponInput) =>
    call<{ coupon: Coupon }>(token, id ? `/api/admin/kitchen/coupons/${id}` : "/api/admin/kitchen/coupons", { method: id ? "PUT" : "POST", body: input }),
  remove: (token: string | null, kind: "categories" | "banners" | "coupons", id: number) => call<{ deleted: true }>(token, `/api/admin/kitchen/${kind}/${id}`, { method: "DELETE" }),
  deleteMeal: (token: string | null, id: string) => call<{ deleted: true }>(token, `/api/admin/kitchen/meals/${encodeURIComponent(id)}`, { method: "DELETE" }),
  // A hidden copy of a meal (with its recipe and kitchens), opened to edit
  duplicateMeal: (token: string | null, id: string) => call<{ meal: AdminMeal }>(token, `/api/admin/kitchen/meals/${encodeURIComponent(id)}/duplicate`, { method: "POST" }),
  slots: (token: string | null) => call<{ slots: Slots }>(token, "/api/admin/kitchen/slots"),
  saveSlots: (token: string | null, slots: Slots) => call<{ slots: Slots }>(token, "/api/admin/kitchen/slots", { method: "PUT", body: { slots } }),
  orders: (token: string | null, day: string) => call<{ date: string; orders: Order[]; counts: Record<string, number> }>(token, `/api/admin/kitchen/orders?day=${day}`),
  advance: (token: string | null, id: string, from: OrderStatus) =>
    call<{ order: Order; macroLogged: boolean | null }>(token, `/api/admin/kitchen/orders/${encodeURIComponent(id)}/advance`, { method: "POST", body: { from } }),
  cancel: (token: string | null, id: string, reason: string) =>
    call<{ order: Order }>(token, `/api/admin/kitchen/orders/${encodeURIComponent(id)}/cancel`, { method: "POST", body: { reason } }),
};
