import type { UsageModule } from "@/lib/appUsage";
import type { Icon } from "@/types/profile";

// Icons and the order of the modules on Super Admin › App Usage. Labels come from the server
// with the numbers, so the screen and the API never disagree about what a feature is called.

export const MODULE_ICON: Record<UsageModule, Icon> = {
  nutrition: { ios: "fork.knife", android: "restaurant", web: "restaurant" },
  workout: { ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" },
  coach: { ios: "sparkles", android: "auto_awesome", web: "auto_awesome" },
  community: { ios: "person.2.fill", android: "group", web: "group" },
  stories: { ios: "camera.fill", android: "photo_camera", web: "photo_camera" },
  attendance: { ios: "qrcode", android: "qr_code", web: "qr_code" },
  progress: { ios: "scalemass.fill", android: "monitor_weight", web: "monitor_weight" },
};

// How many features the Most used / Least used lists show
export const RANK_LIMIT = 5;

// How a screen's route segment reads on the screen
export const SCREEN_LABEL: Record<string, string> = {
  home: "Home",
  meals: "Meals",
  coach: "AI Coach",
  macro: "Macro",
  community: "Community",
  workout: "Workout",
  profile: "Profile",
  "my-qr": "My QR code",
  messages: "Messages",
  measurements: "Measurements",
};
