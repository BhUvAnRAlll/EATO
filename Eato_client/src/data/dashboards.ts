import type { Role } from "@/lib/roles";
import type { Icon } from "@/types/profile";

export type DashboardTile = {
  id: string;
  title: string;
  subtitle: string;
  icon: Icon;
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
        title: "Nutrition diary",
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
    subtitle: "Manage people, menu and orders across EATO.",
    tiles: [
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
        id: "clients",
        title: "My clients",
        subtitle: "Goals, targets and progress",
        icon: { ios: "person.2", android: "group", web: "group" },
      },
      {
        id: "plans",
        title: "Workout plans",
        subtitle: "Build and assign plans",
        icon: { ios: "list.bullet.clipboard", android: "assignment", web: "assignment" },
      },
      {
        id: "check-ins",
        title: "Check-ins",
        subtitle: "Weekly weigh-ins and photos",
        icon: { ios: "checkmark.circle", android: "check_circle", web: "check_circle" },
      },
      {
        id: "messages",
        title: "Messages",
        subtitle: "Chat with your clients",
        icon: { ios: "bubble.left.and.bubble.right", android: "forum", web: "forum" },
      },
    ],
  },
};
