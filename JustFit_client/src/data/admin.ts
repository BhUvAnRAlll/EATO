import type { Href } from "expo-router";

import type { TabItem } from "@/components/BottomTabBar";
import type { Icon } from "@/types/profile";

// The Super Admin portal's tabs, in order (app/admin/(tabs)/): Overview · Orders · Gyms · Users · More
export const adminTabs: TabItem[] = [
  { name: "index", label: "Overview", icon: { ios: "square.grid.2x2", android: "grid_view", web: "grid_view" } },
  { name: "orders", label: "Orders", icon: { ios: "bag", android: "shopping_bag", web: "shopping_bag" } },
  { name: "gyms", label: "Gyms", icon: { ios: "building.2", android: "apartment", web: "apartment" } },
  { name: "users", label: "Users", icon: { ios: "person.2", android: "group", web: "group" } },
  { name: "more", label: "More", icon: { ios: "ellipsis.circle", android: "more_horiz", web: "more_horiz" } },
];

export type AdminLink = { label: string; line: string; href: Href; icon: Icon };
export type AdminSection = { title: string; links: AdminLink[] };

// The More tab: every Super Admin area, in groups, so nothing hides inside another screen
export const adminSections: AdminSection[] = [
  {
    title: "Meals and kitchens",
    links: [
      { label: "Meal operations", line: "Today's orders, revenue and kitchens", href: "/admin/meal-ops", icon: { ios: "chart.bar", android: "bar_chart", web: "bar_chart" } },
      { label: "Menu", line: "Every meal: add, edit, show or hide", href: "/admin/meals", icon: { ios: "fork.knife", android: "restaurant", web: "restaurant" } },
      { label: "Kitchens", line: "Hours, pincodes, staff, menu and stock", href: "/admin/kitchens", icon: { ios: "frying.pan", android: "skillet", web: "skillet" } },
      { label: "Delivery", line: "Partners, who carries what, failed deliveries", href: "/admin/delivery", icon: { ios: "bicycle", android: "pedal_bike", web: "pedal_bike" } },
      { label: "Subscriptions", line: "Members' meal subscriptions and prices", href: "/admin/subscriptions", icon: { ios: "calendar", android: "calendar_month", web: "calendar_month" } },
      { label: "Issues", line: "Members' reports: missing, wrong, late, refunds", href: "/admin/issues", icon: { ios: "exclamationmark.bubble", android: "report", web: "report" } },
      { label: "Reports", line: "Revenue, kitchens, delivery, subscriptions", href: "/admin/reports", icon: { ios: "chart.line.uptrend.xyaxis", android: "insights", web: "insights" } },
    ],
  },
  {
    title: "Meals tab",
    links: [
      { label: "Categories", line: "Tiles and food categories", href: "/admin/meals/categories", icon: { ios: "square.grid.2x2", android: "grid_view", web: "grid_view" } },
      { label: "Banners", line: "The big carousel, with dates", href: "/admin/meals/banners", icon: { ios: "photo.on.rectangle", android: "view_carousel", web: "view_carousel" } },
      { label: "Coupons", line: "Codes members apply at checkout", href: "/admin/meals/coupons", icon: { ios: "tag", android: "sell", web: "sell" } },
      { label: "Delivery times", line: "Breakfast, lunch, dinner and holidays", href: "/admin/meals/times", icon: { ios: "clock", android: "schedule", web: "schedule" } },
    ],
  },
  {
    title: "Gyms",
    links: [
      { label: "Complaints", line: "Reports members sent about gyms", href: "/admin/complaints", icon: { ios: "flag", android: "flag", web: "flag" } },
      { label: "Gym analytics", line: "Branches, memberships, visits and exports", href: "/admin/gyms/analytics", icon: { ios: "chart.bar.xaxis", android: "monitoring", web: "monitoring" } },
      { label: "All gym staff", line: "Every gym's owners, staff and trainers", href: "/admin/gyms/staff", icon: { ios: "person.3", android: "groups", web: "groups" } },
    ],
  },
  {
    title: "Fitness content",
    links: [
      { label: "Programs", line: "The Fitness tab's free programs", href: "/admin/programs", icon: { ios: "square.stack", android: "view_agenda", web: "view_agenda" } },
      { label: "Exercises", line: "Every workout exercise and its demo video", href: "/admin/exercises", icon: { ios: "figure.strengthtraining.traditional", android: "fitness_center", web: "fitness_center" } },
      { label: "Home promotions", line: "What members see on Home", href: "/admin/promotions", icon: { ios: "photo", android: "image", web: "image" } },
    ],
  },
  {
    title: "Platform",
    links: [
      { label: "Body scans", line: "Every member's scan photos and reports", href: "/admin/body-scans", icon: { ios: "figure.stand", android: "accessibility_new", web: "accessibility_new" } },
      { label: "Notifications", line: "Gyms waiting for review and other alerts", href: "/admin/notifications", icon: { ios: "bell", android: "notifications", web: "notifications" } },
      { label: "Platform settings", line: "Registration, documents and defaults", href: "/admin/platform-settings", icon: { ios: "slider.horizontal.3", android: "tune", web: "tune" } },
      { label: "AI Usage", line: "Requests, cost and the monthly budget", href: "/admin/ai-usage", icon: { ios: "sparkles", android: "auto_awesome", web: "auto_awesome" } },
      { label: "App Usage", line: "Which features members use", href: "/admin/app-usage", icon: { ios: "chart.line.uptrend.xyaxis", android: "trending_up", web: "trending_up" } },
    ],
  },
];
