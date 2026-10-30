import type { TabItem } from "@/components/BottomTabBar";

// The Super Admin portal's tabs, in order (app/admin/(tabs)/)
export const adminTabs: TabItem[] = [
  { name: "index", label: "Overview", icon: { ios: "square.grid.2x2", android: "grid_view", web: "grid_view" } },
  { name: "users", label: "Users", icon: { ios: "person.2", android: "group", web: "group" } },
  { name: "gyms", label: "Gyms", icon: { ios: "building.2", android: "apartment", web: "apartment" } },
  { name: "reports", label: "Reports", icon: { ios: "flag", android: "flag", web: "flag" } },
  { name: "content", label: "Content", icon: { ios: "photo", android: "image", web: "image" } },
];
