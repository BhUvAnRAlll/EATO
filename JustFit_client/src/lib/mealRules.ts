// Meal ordering's words and small sums for the screens (pure, unit-tested in
// lib/__tests__/mealRules.test.ts). The server decides prices, open meal times and steps; these
// only say them.

export type Diet = "vegetarian" | "non-vegetarian" | "eggetarian" | "vegan";
export type MealSlot = "breakfast" | "lunch" | "dinner";
export type OrderStatus = "awaiting_payment" | "placed" | "accepted" | "preparing" | "quality_check" | "ready" | "out_for_delivery" | "delivered" | "cancelled";

export const MEAL_SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner"];
// The member's timeline (quality check and ready count as preparing for them)
export const ORDER_STEPS: OrderStatus[] = ["placed", "accepted", "preparing", "out_for_delivery", "delivered"];

export const DIET_LABEL: Record<Diet, string> = { vegetarian: "Veg", "non-vegetarian": "Non-veg", eggetarian: "Egg", vegan: "Vegan" };
export const DIET_FILTERS: { value: Diet | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "vegetarian", label: "Veg" },
  { value: "non-vegetarian", label: "Non-veg" },
  { value: "eggetarian", label: "Egg" },
  { value: "vegan", label: "Vegan" },
];
export const SLOT_LABEL: Record<string, string> = { breakfast: "Breakfast", lunch: "Lunch", snack: "Snack", dinner: "Dinner" };

// What the member reads for each step
export const STATUS_LABEL: Record<OrderStatus, string> = {
  awaiting_payment: "Awaiting payment",
  placed: "Order placed",
  accepted: "Accepted",
  preparing: "Preparing",
  quality_check: "Quality check",
  ready: "Ready for pickup",
  out_for_delivery: "On the way",
  delivered: "Delivered",
  cancelled: "Cancelled",
};
// The admin's one big button for each step (none once delivered or cancelled)
// (Since phase 3 the kitchen's steps: Accept → Start preparing → Quality check → Ready for pickup →
// Out for delivery → Mark delivered. Before migration 2027-01-05 the server answers `steps` with the
// four older ones and LEGACY_NEXT_STEP_LABEL applies.)
export const NEXT_STEP_LABEL: Partial<Record<OrderStatus, string>> = {
  placed: "Accept",
  accepted: "Start preparing",
  preparing: "Quality check done",
  quality_check: "Ready for pickup",
  ready: "Out for delivery",
  out_for_delivery: "Mark delivered",
};
export const LEGACY_NEXT_STEP_LABEL: Partial<Record<OrderStatus, string>> = {
  placed: "Start preparing",
  preparing: "Out for delivery",
  out_for_delivery: "Mark delivered",
};

/** ₹1,249 (Indian grouping) */
export function rupees(amount: number): string {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

/** "07:00" → "7 am", "12:30" → "12:30 pm", "19:00" → "7 pm" */
export function clockText(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

/** "7 – 9 am", "12:30 – 2 pm", "11 am – 1 pm" */
export function timeRange(startsAt: string, endsAt: string): string {
  const [a, b] = [clockText(startsAt), clockText(endsAt)];
  const [aTime, aHalf] = a.split(" ");
  const [, bHalf] = b.split(" ");
  return aHalf === bHalf ? `${aTime} – ${b}` : `${a} – ${b}`;
}

/** "Today", "Tomorrow", else "Wed 12 Nov", for a YYYY-MM-DD day against `today` */
export function dayLabel(date: string, today: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const diff = Math.round((d.getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** Moves a "HH:MM" by `minutes`, kept inside the day (00:00 to 23:30) */
export function shiftTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = Math.min(23 * 60 + 30, Math.max(0, h * 60 + m + minutes));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** The time orders close: 2 hours (`cutoffMinutes`) before the meal time starts */
export function closesAtText(startsAt: string, cutoffMinutes: number): string {
  return clockText(shiftTime(startsAt, -cutoffMinutes));
}

/** How far along the order is: 0 placed … 4 delivered; -1 cancelled (or awaiting payment) */
export function stepIndex(status: OrderStatus): number {
  if (status === "quality_check" || status === "ready") return ORDER_STEPS.indexOf("preparing");
  return ORDER_STEPS.indexOf(status);
}

/** A meal's macro line: "520 kcal · 32g P · 48g C · 18g F" */
export function macroLine(meal: { calories: number; proteinG: number; carbsG: number; fatG: number }): string {
  return `${Math.round(meal.calories)} kcal · ${Math.round(meal.proteinG)}g P · ${Math.round(meal.carbsG)}g C · ${Math.round(meal.fatG)}g F`;
}

/** Whether the kcal the macros add up to (4·P + 4·C + 9·F) is far from the kcal typed (over 15% and 40 kcal) */
export function macrosMismatch(calories: number, proteinG: number, carbsG: number, fatG: number): boolean {
  const fromMacros = proteinG * 4 + carbsG * 4 + fatG * 9;
  const gap = Math.abs(fromMacros - calories);
  return calories > 0 && gap > 40 && gap / calories > 0.15;
}

export type CartLine = { mealId: string; quantity: number; price: number; calories: number; proteinG: number };

/** The cart's totals: meals, rupees, kcal and protein */
export function cartTotals(lines: CartLine[]) {
  return lines.reduce(
    (t, l) => ({ count: t.count + l.quantity, total: t.total + l.price * l.quantity, calories: t.calories + l.calories * l.quantity, proteinG: t.proteinG + l.proteinG * l.quantity }),
    { count: 0, total: 0, calories: 0, proteinG: 0 },
  );
}

/** The order's items as one line: "2 × Paneer Bowl, Egg Bhurji" */
export function itemsLine(items: { name: string; quantity: number }[]): string {
  return items.map((i) => (i.quantity > 1 ? `${i.quantity} × ${i.name}` : i.name)).join(", ");
}

/** An open order (not delivered or cancelled) */
export const isOpen = (status: OrderStatus) => status !== "delivered" && status !== "cancelled";

/** A YYYY-MM-DD day moved by `days` */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Google Maps directions to a point, else to the address line (the phone opens its maps app) */
export function directionsUrl(address: { latitude: number | null; longitude: number | null; line: string | null }): string | null {
  if (address.latitude !== null && address.longitude !== null) return `https://www.google.com/maps/dir/?api=1&destination=${address.latitude},${address.longitude}`;
  if (address.line) return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address.line)}`;
  return null;
}

// ---- The Meals tab's storefront (sections built on the phone from one read) ----

export type Tag = "bestseller" | "gourmet" | "high_protein" | "special";
export const TAG_LABEL: Record<Tag, string> = { bestseller: "Bestseller", gourmet: "Gourmet", high_protein: "High protein", special: "Today's special" };
export const TAG_LIST_TITLE: Record<Tag, string> = { bestseller: "Bestsellers", gourmet: "Gourmet meals", high_protein: "High protein", special: "Today's specials" };
export const HIGH_PROTEIN_G = 25; // a meal with at least this much protein counts as high protein

type ShopMeal = { id: string; name: string; description: string | null; ingredients: string | null; diet: Diet; tags: Tag[]; proteinG: number; price: number; mrp: number | null };
type ShopCategory = { id: number; kind: "tile" | "food"; name: string; featured: boolean; mealIds: string[] };

/** Veg only means vegetarian and vegan (egg is not veg) */
export const isVeg = (diet: Diet) => diet === "vegetarian" || diet === "vegan";

/** "20% off" from the price and the price before it, or null */
export function discountText(price: number, mrp: number | null): string | null {
  if (!mrp || mrp <= price) return null;
  return `${Math.round(((mrp - price) / mrp) * 100)}% off`;
}

/** The one badge a card shows: Bestseller, then High protein, then Gourmet, then Today's special */
export function cardBadge(meal: { tags: Tag[]; proteinG: number }): string | null {
  for (const tag of ["bestseller", "high_protein", "gourmet", "special"] as Tag[]) if (meal.tags.includes(tag)) return TAG_LABEL[tag];
  return meal.proteinG >= HIGH_PROTEIN_G ? TAG_LABEL.high_protein : null;
}

/** Every word of the search must appear in the meal's name, description, ingredients or one of its categories */
export function searchMeals<M extends ShopMeal>(meals: M[], categories: ShopCategory[], query: string): M[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return meals;
  const catNames = new Map<string, string>();
  for (const c of categories) for (const id of c.mealIds) catNames.set(id, `${catNames.get(id) ?? ""} ${c.name.toLowerCase()}`);
  const scored = meals
    .map((m) => {
      const name = m.name.toLowerCase();
      const hay = `${name} ${m.description ?? ""} ${m.ingredients ?? ""} ${catNames.get(m.id) ?? ""}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return null;
      return { m, score: words.filter((w) => name.includes(w)).length * 2 + (name.startsWith(words[0]) ? 1 : 0) };
    })
    .filter((x): x is { m: M; score: number } => x !== null);
  return scored.sort((a, b) => b.score - a.score || a.m.name.localeCompare(b.m.name)).map((x) => x.m);
}

/** Up to `max` suggestions for a search: meal and category names containing what's typed */
export function suggestions(meals: { name: string }[], categories: { name: string }[], query: string, max = 5): string[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const names = [...categories.map((c) => c.name), ...meals.map((m) => m.name)];
  const starts = names.filter((n) => n.toLowerCase().startsWith(q));
  const contains = names.filter((n) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q));
  return [...new Set([...starts, ...contains])].filter((n) => n.toLowerCase() !== q).slice(0, max);
}

/**
 * The Meals tab's sections from the storefront, after the Veg only switch: the tiles, the food
 * categories, one row per featured food category, today's specials (tagged, or discounted), and
 * the high-protein meals (tagged, or 25 g and over), most protein first. Empty sections and
 * categories with no meals left are dropped.
 */
export function shopSections<M extends ShopMeal, C extends ShopCategory>(meals: M[], categories: C[], vegOnly: boolean) {
  const shown = vegOnly ? meals.filter((m) => isVeg(m.diet)) : meals;
  const byId = new Map(shown.map((m) => [m.id, m]));
  const withMeals = categories.map((c) => ({ category: c, meals: c.mealIds.map((id) => byId.get(id)).filter((m): m is M => !!m) })).filter((x) => x.meals.length > 0);
  const specials = shown.filter((m) => m.tags.includes("special") || (m.mrp !== null && m.mrp > m.price));
  return {
    meals: shown,
    tiles: withMeals.filter((x) => x.category.kind === "tile").map((x) => x.category),
    foods: withMeals.filter((x) => x.category.kind === "food").map((x) => x.category),
    rows: withMeals.filter((x) => x.category.kind === "food" && x.category.featured),
    specials: specials.length > 0 ? specials : shown.filter((m) => m.tags.includes("bestseller")),
    highProtein: shown.filter((m) => m.tags.includes("high_protein") || m.proteinG >= HIGH_PROTEIN_G).sort((a, b) => b.proteinG - a.proteinG).slice(0, 12),
  };
}

// ---- The Meals tab's quick lists and sort (2026-11-10 rebuild from the user's design) ----

export const LOW_CALORIE_KCAL = 400; // a meal at or under this many kcal counts as low calorie
export type QuickList = "popular" | "specials" | "high_protein" | "low_calorie" | "veg" | "non_veg" | "combos";
export const QUICK_LIST_TITLE: Record<QuickList, string> = {
  popular: "Popular meals",
  specials: "Today's specials",
  high_protein: "High protein",
  low_calorie: "Low calorie",
  veg: "Veg meals",
  non_veg: "Non-veg meals",
  combos: "Combos",
};
export const QUICK_LIST_SUBTITLE: Partial<Record<QuickList, string>> = {
  specials: "Popular picks and deals",
  high_protein: "Most protein first",
  low_calorie: `${LOW_CALORIE_KCAL} kcal or less, lightest first`,
  combos: "Thalis and meal combos",
};
export const isQuickList = (value: string | undefined): value is QuickList => !!value && Object.prototype.hasOwnProperty.call(QUICK_LIST_TITLE, value);

/** Bestsellers first, then today's specials, then the rest of the menu, at most `max` */
export function popularMeals<M extends ShopMeal>(meals: M[], max = 12): M[] {
  const rank = (m: M) => (m.tags.includes("bestseller") ? 0 : m.tags.includes("special") || (m.mrp !== null && m.mrp > m.price) ? 1 : 2);
  return meals.map((m, i) => ({ m, i })).sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i).slice(0, max).map((x) => x.m);
}

/** One quick list from the menu: the tiles under the search and each section's See all */
export function quickList<M extends ShopMeal & { calories: number }, C extends ShopCategory>(meals: M[], categories: C[], list: QuickList): M[] {
  const sections = shopSections(meals, categories, false);
  if (list === "popular") return popularMeals(meals, meals.length);
  if (list === "specials") return sections.specials;
  if (list === "high_protein") return sections.highProtein;
  if (list === "low_calorie") return meals.filter((m) => m.calories <= LOW_CALORIE_KCAL).sort((a, b) => a.calories - b.calories);
  if (list === "veg") return meals.filter((m) => isVeg(m.diet));
  if (list === "non_veg") return meals.filter((m) => m.diet === "non-vegetarian" || m.diet === "eggetarian");
  // Combos: meals in a category named like "Combos", and meals called a combo or a thali
  const inCombos = new Set(categories.filter((c) => /combo/i.test(c.name)).flatMap((c) => c.mealIds));
  return meals.filter((m) => inCombos.has(m.id) || /\b(combo|thali)\b/i.test(m.name));
}

export type MealSort = "recommended" | "protein" | "calories" | "price";
export const MEAL_SORTS: { value: MealSort; label: string }[] = [
  { value: "recommended", label: "Recommended" },
  { value: "protein", label: "Most protein" },
  { value: "calories", label: "Fewest kcal" },
  { value: "price", label: "Price: low to high" },
];

/** The meals in the chosen order (a copy; "recommended" keeps the menu's order) */
export function sortMeals<M extends { price: number; proteinG: number; calories: number }>(meals: M[], sort: MealSort): M[] {
  const list = [...meals];
  if (sort === "price") list.sort((a, b) => a.price - b.price);
  if (sort === "protein") list.sort((a, b) => b.proteinG - a.proteinG);
  if (sort === "calories") list.sort((a, b) => a.calories - b.calories);
  return list;
}

/** The menu narrowed to one diet (null = every meal) */
export function byDiet<M extends { diet: Diet }>(meals: M[], diet: Diet | null): M[] {
  return diet ? meals.filter((m) => m.diet === diet) : meals;
}
