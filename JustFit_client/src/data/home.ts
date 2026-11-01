import type { Href } from "expo-router";

import type { Icon } from "@/types/profile";
import { colors, Palette } from "@/theme";

// The home screen's content comes from the justFit server (admins edit it there). The types
// below mirror the API shape (see JustFit_server/home.js); the defaults are what the screen
// shows before the first successful load and when the server can't be reached.

// Screens a promotion button or quick-action card may open. The server allows only
// these keys, and the app only ever navigates to the routes listed here.
export const destinationRoutes = {
  home: "/home",
  meals: "/meals",
  explore: "/meals", // older content saved as "explore" opens the Meals tab
  macro: "/macro",
  nutrition: "/macro", // older content saved as "nutrition" opens the Macro tab
  fitness: "/workout",
  plans: "/plans",
  orders: "/orders",
  profile: "/profile",
  goals: "/goals",
  notifications: "/notifications",
  addresses: "/addresses",
} as const satisfies Record<string, Href>;

export type Destination = keyof typeof destinationRoutes;

export const destinations = Object.keys(destinationRoutes) as Destination[];

// The route for a destination key the server sent, or null for anything unknown
export function routeFor(destination: string): Href | null {
  return destination in destinationRoutes ? destinationRoutes[destination as Destination] : null;
}

// Icons a quick-action card may show, with the tint and soft container colour of each
export const quickActionIcons = (colors: Palette) => ({
  meals: { icon: { ios: "fork.knife.circle", android: "room_service", web: "room_service" }, tint: colors.iconGreen, background: colors.tintGreen },
  plans: { icon: { ios: "dumbbell", android: "fitness_center", web: "fitness_center" }, tint: colors.iconPeach, background: colors.tintPeach },
  nutrition: { icon: { ios: "chart.bar.fill", android: "bar_chart", web: "bar_chart" }, tint: colors.primary, background: colors.accentSoft },
  delivery: { icon: { ios: "truck.box", android: "local_shipping", web: "local_shipping" }, tint: colors.iconBlue, background: colors.tintBlue },
  flame: { icon: { ios: "flame.fill", android: "local_fire_department", web: "local_fire_department" }, tint: colors.iconPeach, background: colors.tintPeach },
  heart: { icon: { ios: "heart.fill", android: "favorite", web: "favorite" }, tint: colors.iconLavender, background: colors.tintLavender },
  calendar: { icon: { ios: "calendar", android: "calendar_today", web: "calendar_today" }, tint: colors.iconBlue, background: colors.tintBlue },
  bag: { icon: { ios: "bag.fill", android: "shopping_bag", web: "shopping_bag" }, tint: colors.iconGreen, background: colors.tintGreen },
} satisfies Record<string, { icon: Icon; tint: string; background: string }>);

export type QuickActionIconKey = keyof ReturnType<typeof quickActionIcons>;

export const quickActionIconKeys = Object.keys(quickActionIcons(colors)) as QuickActionIconKey[];

export type PromotionStatus = "draft" | "published" | "disabled";

// The fields an admin edits
export type PromotionFields = {
  title: string;
  eyebrow: string;
  headline: string;
  description: string;
  imageUrl: string; // "asset:<key>" (see homeImages in constants/images.ts) or an https URL
  imageAlt: string | null;
  ctaLabel: string;
  ctaAction: "open_screen";
  ctaDestination: string;
  secondaryCtaLabel: string | null;
  secondaryCtaAction: "open_screen" | null;
  secondaryCtaDestination: string | null;
  textAlign: "left" | "center";
  imagePosition: "right" | "left";
  backgroundColor: string | null;
  textColor: string | null;
  status: PromotionStatus;
  rotationIntervalSeconds: number;
  startsAt: string | null; // ISO date-time
  endsAt: string | null;
};

export type Promotion = PromotionFields & {
  id: number;
  // What the admin sees: "scheduled" / "ended" for a published promotion outside its window
  effectiveStatus: PromotionStatus | "scheduled" | "ended";
  displayOrder: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type QuickAction = {
  id: string;
  title: string;
  subtitle: string;
  icon: string; // a quickActionIcons key
  destination: string; // a destinationRoutes key
};

export type Meal = {
  id: string;
  name: string;
  imageUrl: string | null;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

export type HomeContent = {
  nutritionHeading: string;
  nutritionActionLabel: string;
  popularHeading: string;
  popularActionLabel: string;
  todayHeading: string;
  todayActionLabel: string;
  showTodaySection: boolean;
  quickActions: QuickAction[];
  popularMealIds: string[];
  popularMeals: Meal[];
  updatedAt: string | null;
};

const promotionDefaults = {
  imageAlt: null,
  ctaAction: "open_screen" as const,
  secondaryCtaLabel: null,
  secondaryCtaAction: null,
  secondaryCtaDestination: null,
  textAlign: "left" as const,
  imagePosition: "right" as const,
  backgroundColor: null,
  textColor: null,
  status: "published" as const,
  effectiveStatus: "published" as const,
  rotationIntervalSeconds: 2,
  startsAt: null,
  endsAt: null,
  createdBy: null,
  updatedBy: null,
  createdAt: null,
  updatedAt: null,
};

// Shown until the server's promotions arrive (the same three schema.sql seeds)
export const defaultPromotions: Promotion[] = [
  {
    ...promotionDefaults,
    id: -1,
    displayOrder: 1,
    title: "Chef-prepared meals",
    eyebrow: "CHEF-PREPARED",
    headline: "Healthy meals for a stronger you",
    description: "Nutritious, chef-prepared meals delivered to your doorstep.",
    imageUrl: "asset:hero-bowl",
    ctaLabel: "Order Now",
    ctaDestination: "explore",
  },
  {
    ...promotionDefaults,
    id: -2,
    displayOrder: 2,
    title: "Your fitness, your food",
    eyebrow: "YOUR FITNESS, YOUR FOOD",
    headline: "Eat better. Reach your goals.",
    description: "Delicious meals designed around your nutrition targets.",
    imageUrl: "asset:hero-nutrition",
    ctaLabel: "Explore Meals",
    ctaDestination: "explore",
  },
  {
    ...promotionDefaults,
    id: -3,
    displayOrder: 3,
    title: "Fuel your day",
    eyebrow: "FUEL YOUR DAY",
    headline: "Better nutrition starts here",
    description: "Find meals that fit your lifestyle and daily macros.",
    imageUrl: "asset:hero-delivery",
    ctaLabel: "View Menu",
    ctaDestination: "explore",
  },
];

export const sampleMeals: Meal[] = [
  { id: "grilled-chicken-bowl", name: "Grilled Chicken Bowl", imageUrl: "asset:meal-grilled-chicken", calories: 470, proteinG: 44, carbsG: 38, fatG: 14 },
  { id: "paneer-tikka-bowl", name: "Paneer Tikka Bowl", imageUrl: "asset:meal-paneer-tikka", calories: 540, proteinG: 32, carbsG: 58, fatG: 18 },
  { id: "salmon-bowl", name: "Salmon Bowl", imageUrl: "asset:meal-salmon", calories: 560, proteinG: 42, carbsG: 48, fatG: 20 },
];

export const defaultHomeContent: HomeContent = {
  nutritionHeading: "Today's Macros",
  nutritionActionLabel: "Edit Goal",
  popularHeading: "Popular Meals",
  popularActionLabel: "View all",
  todayHeading: "Today",
  todayActionLabel: "View all",
  showTodaySection: true,
  // No quick-action cards by default (the bottom tabs already lead to these screens); an
  // admin can still add cards on the Home content screen
  quickActions: [],
  popularMealIds: sampleMeals.map((meal) => meal.id),
  popularMeals: sampleMeals,
  updatedAt: null,
};

// A day's intake against the targets, for the nutrition rings
export type NutritionAmounts = { calories: number; proteinG: number; carbsG: number; fatG: number };

export type NutritionToday = {
  consumed: NutritionAmounts;
  targets: NutritionAmounts;
  // "targets" = the member's saved targets, with what the Macro diary says was eaten today;
  // "sample" = placeholder numbers because the targets couldn't be loaded
  source: "targets" | "sample";
};

export const sampleNutrition: NutritionToday = {
  consumed: { calories: 420, proteinG: 24, carbsG: 52, fatG: 12 },
  targets: { calories: 3030, proteinG: 172, carbsG: 397, fatG: 84 },
  source: "sample",
};

// One delivery on the "Today" card
export type TodayOrder = {
  slot: string; // e.g. "LUNCH"
  meal: Meal;
  status: string; // e.g. "Received"
};

// Orders aren't built yet: the Today card shows this sample and says so
export const sampleTodayOrder: TodayOrder = {
  slot: "LUNCH",
  meal: { id: "lemon-herb-chicken-bowl", name: "Lemon Herb Chicken Bowl", imageUrl: "asset:meal-lemon-herb-chicken", calories: 470, proteinG: 44, carbsG: 38, fatG: 14 },
  status: "Received",
};

// Delivery addresses aren't built yet either: an example pincode for the header
export const sampleDeliveryPincode = "110017";

// Every bottom tab, in order
// Home dashboard, meals and menu, the AI Coach, macro balance (calories and macros), workouts
export type HomeTab = { name: "home" | "meals" | "macro" | "coach" | "workout"; label: string; icon: Icon; raised?: boolean };

export const homeTabs: HomeTab[] = [
  { name: "home", label: "Home", icon: { ios: "house", android: "home", web: "home" } },
  { name: "meals", label: "Meals", icon: { ios: "fork.knife", android: "restaurant", web: "restaurant" } },
  // AI Coach sits in the middle as a raised round button
  { name: "coach", label: "AI Coach", icon: { ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }, raised: true },
  { name: "macro", label: "Macro", icon: { ios: "scalemass", android: "balance", web: "balance" } },
  { name: "workout", label: "Workout", icon: { ios: "dumbbell", android: "fitness_center", web: "fitness_center" } },
];
