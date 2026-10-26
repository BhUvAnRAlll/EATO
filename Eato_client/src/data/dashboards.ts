import type { Href } from "expo-router";

import type { Role } from "@/lib/roles";
import type { Icon } from "@/types/profile";

export type DashboardTile = {
  id: string;
  title: string;
  subtitle: string;
  icon: Icon;
  // The screen the tile opens; tiles without one are placeholders ("Soon")
  href?: Href;
};

export type Dashboard = {
  // Short label shown above the greeting (e.g. "Admin")
  label: string;
  subtitle: string;
  tiles: DashboardTile[];
};

// What each role sees after logging in. Tiles are placeholders until each area is built.
export const dashboards: Record<Role, Dashboard> = {
  user: {
    label: "Home",
    subtitle: "Your meals, nutrition and training in one place.",
    tiles: [
      {
        id: "meals",
        title: "Today's meals",
        subtitle: "Order or track your deliveries",
        icon: { ios: "fork.knife", android: "restaurant", web: "restaurant" },
      },
      {
        id: "nutrition",
        title: "Macro diary",
        subtitle: "Calories, macros and water",
        icon: { ios: "flame", android: "local_fire_department", web: "local_fire_department" },
      },
      {
        id: "training",
        title: "Training",
        subtitle: "Workout plans and progress",
        icon: { ios: "figure.strengthtraining.traditional", android: "fitness_center", web: "fitness_center" },
      },
      {
        id: "coach",
        title: "AI Coach",
        subtitle: "Ask about food and fitness",
        icon: { ios: "bubble.left.and.bubble.right", android: "forum", web: "forum" },
      },
    ],
  },
  admin: {
    label: "Admin",
    subtitle: "Manage people, menu and orders across JustFit.",
    tiles: [
      {
        id: "home-screen",
        title: "Home Screen & Promotions",
        subtitle: "Hero slides, labels and popular meals",
        icon: { ios: "rectangle.3.group", android: "dashboard_customize", web: "dashboard_customize" },
        href: "/admin/promotions",
      },
      {
        id: "moderation",
        title: "Community moderation",
        subtitle: "Reports and suspended members",
        icon: { ios: "flag", android: "flag", web: "flag" },
        href: "/admin/moderation",
      },
      {
        id: "gyms",
        title: "Gyms",
        subtitle: "Create gym communities and name owners",
        icon: { ios: "dumbbell", android: "fitness_center", web: "fitness_center" },
        href: "/admin/gyms",
      },
      {
        id: "users",
        title: "Users",
        subtitle: "View members and their plans",
        icon: { ios: "person.2", android: "group", web: "group" },
      },
      {
        id: "trainers",
        title: "Trainers",
        subtitle: "Invite trainers and assign clients",
        icon: { ios: "figure.strengthtraining.traditional", android: "fitness_center", web: "fitness_center" },
      },
      {
        id: "menu",
        title: "Menu",
        subtitle: "Meals, prices and availability",
        icon: { ios: "fork.knife", android: "restaurant", web: "restaurant" },
      },
      {
        id: "orders",
        title: "Orders",
        subtitle: "Deliveries and subscriptions",
        icon: { ios: "bag", android: "shopping_bag", web: "shopping_bag" },
      },
    ],
  },
  trainer: {
    label: "Trainer",
    subtitle: "Coach your clients and keep them on track.",
    tiles: [
      {
        id: "requests",
        title: "Requests",
        subtitle: "Members asking you to coach them",
        icon: { ios: "person.badge.plus", android: "person_add", web: "person_add" },
        href: "/trainer/requests",
      },
      {
        id: "clients",
        title: "My clients",
        subtitle: "Diet plans, workouts and targets",
        icon: { ios: "person.2", android: "group", web: "group" },
        href: "/trainer/clients",
      },
      {
        id: "messages",
        title: "Messages",
        subtitle: "Chat with your clients",
        icon: { ios: "bubble.left.and.bubble.right", android: "forum", web: "forum" },
        href: "/trainer/messages",
      },
      {
        id: "profile",
        title: "My trainer profile",
        subtitle: "What members see when they find you",
        icon: { ios: "person.text.rectangle", android: "badge", web: "badge" },
        href: "/trainer/profile",
      },
    ],
  },
};
