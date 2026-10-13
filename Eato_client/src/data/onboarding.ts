import type { ImageSourcePropType } from "react-native";

import { images } from "@/constants/images";

export type OnboardingSlide = {
  id: string;
  title: string;
  subtitle: string;
  art: ImageSourcePropType;
  // Width ÷ height of the art image
  artRatio: number;
  // How far (pt) the art tucks up under the subtitle (its top edge fades out)
  artOverlap: number;
};

export const onboardingSlides: OnboardingSlide[] = [
  {
    id: "meals",
    title: "Healthy meals,\nmade for you.",
    subtitle: "Fresh. Nutritious. Delivered to\nyour doorstep.",
    art: images.onboardingArtMeals,
    artRatio: 1053 / 1032,
    artOverlap: 4,
  },
  {
    id: "nutrition",
    title: "Nutrition that\nfits your goals.",
    subtitle: "Balanced meals with the calories\nand protein you need.",
    art: images.onboardingArtNutrition,
    artRatio: 1052 / 1074,
    // Starts higher so the oil bottle sits beside the subtitle, as in the design
    artOverlap: 26,
  },
  {
    id: "progress",
    title: "Your goals,\none meal at a time.",
    subtitle: "Choose your meals, track your\nprogress, feel your best.",
    art: images.onboardingArtProgress,
    artRatio: 1024 / 1081,
    artOverlap: 4,
  },
];
