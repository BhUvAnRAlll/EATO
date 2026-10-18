import type { TabItem } from "@/components/BottomTabBar";

// The gym owner portal's tabs, in order (app/owner/(tabs)/)
export const ownerTabs: TabItem[] = [
  { name: "index", label: "Home", icon: { ios: "square.grid.2x2", android: "grid_view", web: "grid_view" } },
  { name: "members", label: "Members", icon: { ios: "person.2", android: "group", web: "group" } },
  { name: "checkin", label: "Check-in", icon: { ios: "qrcode.viewfinder", android: "qr_code_scanner", web: "qr_code_scanner" } },
  { name: "community", label: "Community", icon: { ios: "bubble.left.and.bubble.right", android: "forum", web: "forum" } },
  { name: "review", label: "Review", icon: { ios: "checkmark.shield", android: "verified_user", web: "verified_user" } },
  { name: "gym", label: "Gym", icon: { ios: "building.2", android: "apartment", web: "apartment" } },
];

// Notes for the tabs that arrive in later phases (shown on their placeholder screens)
export const ownerComingSoon = {
  checkin: "Scan member QR codes at the front desk, see who's in the gym, and run the check-out QR. Coming next.",
  community: "Every part of your gym's community in one place, and notifications to members. Coming soon.",
  review: "Posts waiting for approval and posts members reported. Coming soon.",
} as const;
