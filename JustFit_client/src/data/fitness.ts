import type { FitnessSection, ProgramIcon } from "@/lib/fitness/catalog";
import type { Icon } from "@/types/profile";

// The Fitness tab's art: the symbol drawn on each program card (the server stores the key), and
// how each section lays its cards out.

export const PROGRAM_ICON: Record<ProgramIcon, Icon> = {
  yoga: { ios: "figure.yoga", android: "self_improvement", web: "self_improvement" },
  kids: { ios: "figure.and.child.holdinghands", android: "family_restroom", web: "family_restroom" },
  heart: { ios: "heart.text.square.fill", android: "monitor_heart", web: "monitor_heart" },
  beginner: { ios: "figure.walk", android: "directions_walk", web: "directions_walk" },
  boxing: { ios: "figure.boxing", android: "sports_mma", web: "sports_mma" },
  women: { ios: "figure.strengthtraining.functional", android: "sports_gymnastics", web: "sports_gymnastics" },
  strength: { ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" },
  split: { ios: "figure.strengthtraining.traditional", android: "fitness_center", web: "fitness_center" },
  tone: { ios: "figure.core.training", android: "sports_gymnastics", web: "sports_gymnastics" },
  cardio: { ios: "figure.run", android: "directions_run", web: "directions_run" },
  foundation: { ios: "figure.cross.training", android: "fitness_center", web: "fitness_center" },
  dance: { ios: "figure.dance", android: "music_note", web: "music_note" },
  desk: { ios: "figure.cooldown", android: "chair", web: "chair" },
  posture: { ios: "figure.stand", android: "accessibility_new", web: "accessibility_new" },
  energy: { ios: "bolt.fill", android: "bolt", web: "bolt" },
  walk: { ios: "figure.2", android: "groups", web: "groups" },
  mom: { ios: "figure.and.child.holdinghands", android: "escalator_warning", web: "escalator_warning" },
};

export const programIcon = (key: string): Icon => PROGRAM_ICON[key as ProgramIcon] ?? PROGRAM_ICON.strength;

// Card size per section: big posters for Popular, compact tiles for the categories and the two
// carousels, and wide cards with an Explore button for Dance and Workplace
export type CardVariant = "poster" | "tile" | "wide";
export const SECTION_VARIANT: Record<FitnessSection, CardVariant> = {
  popular: "poster",
  categories: "tile",
  build_muscle: "tile",
  stay_fit: "tile",
  dance: "wide",
  workplace: "wide",
};

export const CARD_SIZE: Record<CardVariant, { width: number; height: number }> = {
  poster: { width: 240, height: 300 },
  tile: { width: 168, height: 208 },
  wide: { width: 296, height: 176 },
};
