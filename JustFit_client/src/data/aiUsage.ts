import type { AiFeature, AiProvider, AiStatus, Period } from "@/lib/aiUsage";
import type { Icon } from "@/types/profile";

// Labels for the Super Admin › AI Usage screens. The sections group the server's features the way
// the spec reads them; a section with no calls in the period still shows, at zero. The gym
// assistant left with the gyms on 2026-11-01: it has no section, and its label stays only for the
// calls it made before then, which are still in the history and the totals.

export const FEATURE_LABEL: Record<AiFeature, string> = {
  gym_assistant: "Gym assistant replies (removed)",
  coach_plan: "Plan generations (meals and workout)",
  coach_meal: "Meal swaps (one meal replaced)",
  coach_chat: "Coaching messages",
  food_scan: "Food photo scans",
  body_scan: "Body fat predictions",
  body_report: "Body composition report reading",
};

export const FEATURE_SHORT: Record<AiFeature, string> = {
  gym_assistant: "Gym assistant (removed)",
  coach_plan: "Coach plan",
  coach_meal: "Meal swap",
  coach_chat: "Coach chat",
  food_scan: "Food scan",
  body_scan: "Body scan",
  body_report: "Report reading",
};

export const STATUS_LABEL: Record<AiStatus, string> = { ok: "OK", failed: "Failed", refused: "Refused" };
export const PROVIDER_LABEL: Record<AiProvider, string> = { openai: "OpenAI", forma: "Forma" };
export const PERIOD_LABEL: Record<Period, string> = { day: "Today", week: "7 days", month: "30 days" };
// The period a change is compared with ("+25% vs yesterday", "nothing in the 7 days before")
export const PERIOD_PREVIOUS: Record<Period, string> = { day: "yesterday", week: "in the 7 days before", month: "in the 30 days before" };

export type AiSection = { id: string; title: string; note: string; icon: Icon; features: AiFeature[] };

export const AI_SECTIONS: AiSection[] = [
  { id: "coach", title: "AI Coach", note: "Plan generations (a day of meals with the workout week), single meal swaps and coaching messages", icon: { ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }, features: ["coach_plan", "coach_meal", "coach_chat"] },
  { id: "food", title: "Food & Nutrition AI", note: "Scan Food: recognising the foods in a photo and estimating their nutrition", icon: { ios: "fork.knife", android: "restaurant", web: "restaurant" }, features: ["food_scan"] },
  { id: "body", title: "Body Fat Prediction AI", note: "Scan Body: the Forma model, self-hosted (no tokens)", icon: { ios: "figure.stand", android: "accessibility_new", web: "accessibility_new" }, features: ["body_scan"] },
  { id: "other", title: "Other AI services", note: "Reading uploaded body composition reports", icon: { ios: "doc.text", android: "description", web: "description" }, features: ["body_report"] },
];
