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

// A feature's own icon on the usage rows; a feature not listed here shows its module's icon
export const FEATURE_ICON: Record<string, Icon> = {
  meal_log: MODULE_ICON.nutrition,
  water_log: { ios: "drop.fill", android: "water_drop", web: "water_drop" },
  food_scan: { ios: "camera.viewfinder", android: "photo_camera", web: "photo_camera" },
  workout_started: { ios: "play.fill", android: "play_arrow", web: "play_arrow" },
  workout_completed: { ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" },
  coach_plan: { ios: "doc.text.fill", android: "description", web: "description" },
  coach_chat: { ios: "bubble.left.and.bubble.right.fill", android: "forum", web: "forum" },
  post: { ios: "square.and.pencil", android: "edit_square", web: "edit_square" },
  like: { ios: "heart.fill", android: "favorite", web: "favorite" },
  comment: { ios: "text.bubble.fill", android: "chat_bubble", web: "chat_bubble" },
  message: { ios: "paperplane.fill", android: "send", web: "send" },
  story_created: MODULE_ICON.stories,
  story_viewed: { ios: "eye.fill", android: "visibility", web: "visibility" },
  check_in: { ios: "arrow.right.to.line", android: "login", web: "login" },
  check_out: { ios: "arrow.left.to.line", android: "logout", web: "logout" },
  weigh_in: MODULE_ICON.progress,
  body_scan: { ios: "figure.stand", android: "accessibility_new", web: "accessibility_new" },
};

// How many features the Most used / Least used lists show
export const RANK_LIMIT = 5;

// Each screen's icon on the Screen visits rows
export const SCREEN_ICON: Record<string, Icon> = {
  home: { ios: "house.fill", android: "home", web: "home" },
  meals: MODULE_ICON.nutrition,
  coach: MODULE_ICON.coach,
  macro: { ios: "chart.pie.fill", android: "pie_chart", web: "pie_chart" },
  community: MODULE_ICON.community,
  workout: MODULE_ICON.workout,
  profile: { ios: "person.fill", android: "person", web: "person" },
  "my-qr": MODULE_ICON.attendance,
  messages: { ios: "paperplane.fill", android: "send", web: "send" },
  measurements: { ios: "ruler.fill", android: "straighten", web: "straighten" },
};

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
