// Icon colours by meaning (2026-11-10, the owner's choice: "don't put all green, some symbols have
// their own uniform colour"). Green stays for main buttons and what's selected; an icon that means
// something takes that meaning's colour on every screen: calories orange, water blue, a heart red,
// a rating amber, a place red, time and dates blue, delivery blue, offers orange, info blue, a
// warning amber, done green. SymbolView applies it when a screen draws the icon in the brand
// green (an icon a screen colours on purpose, grey or white, keeps its colour). Pure: no React Native.
import { lightColors } from "../theme/index.ts";

export type IconMeaning = "calories" | "water" | "favorite" | "rating" | "location" | "time" | "delivery" | "offer" | "info" | "warning" | "success" | "veg";

export const iconMeaningColors: Record<IconMeaning, string> = {
  calories: lightColors.iconCalories,
  water: lightColors.iconWater,
  favorite: lightColors.iconFavorite,
  rating: lightColors.iconRating,
  location: lightColors.iconLocation,
  time: lightColors.iconTime,
  delivery: lightColors.iconDelivery,
  offer: lightColors.iconOffer,
  info: lightColors.iconInfo,
  warning: lightColors.iconWarning,
  success: lightColors.iconSuccess,
  veg: lightColors.iconVeg,
};

// SF Symbol name (its first part) → meaning
const BY_PREFIX: [string, IconMeaning][] = [
  ["flame", "calories"],
  ["drop", "water"],
  ["heart", "favorite"],
  ["star", "rating"],
  ["mappin", "location"],
  ["location", "location"],
  ["map", "location"],
  ["clock", "time"],
  ["timer", "time"],
  ["alarm", "time"],
  ["calendar", "time"],
  ["bicycle", "delivery"],
  ["box.truck", "delivery"],
  ["shippingbox", "delivery"],
  ["tag", "offer"],
  ["ticket", "offer"],
  ["percent", "offer"],
  ["gift", "offer"],
  ["info", "info"],
  ["lightbulb", "info"],
  ["exclamationmark.triangle", "warning"],
  ["checkmark.circle", "success"],
  ["checkmark.seal", "success"],
  ["leaf", "veg"],
];

export function iconMeaning(sf: string | undefined): IconMeaning | null {
  if (!sf) return null;
  for (const [prefix, meaning] of BY_PREFIX) if (sf === prefix || sf.startsWith(`${prefix}.`)) return meaning;
  return null;
}

// The brand greens a screen uses for an icon (primary, leaf, forest and the darker text green)
const BRAND_GREENS = new Set([lightColors.primary, lightColors.primaryText, lightColors.primaryPressed].map((c) => c.toUpperCase()));

/** The colour to draw an icon in: its meaning's colour when the screen asked for the brand green */
export function iconTint(sf: string | undefined, tint: unknown): unknown {
  if (typeof tint !== "string" || !BRAND_GREENS.has(tint.toUpperCase())) return tint;
  const meaning = iconMeaning(sf);
  return meaning ? iconMeaningColors[meaning] : tint;
}
