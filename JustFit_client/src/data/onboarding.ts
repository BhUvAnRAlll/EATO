import { images } from "@/constants/images";

export type OnboardingSlide = {
  id: string;
  title: string;
  subtitle: string;
  // A bundled image (Metro asset id)
  art: number;
  // Width ÷ height of the art image
  artRatio: number;
};

export const onboardingSlides: OnboardingSlide[] = [
  {
    id: "meals",
    title: "Healthy meals,\nmade for you.",
    subtitle: "Fresh. Nutritious. Delivered to your doorstep.",
    art: images.onboardingArtMeals,
    artRatio: 1053 / 1032,
  },
  {
    id: "nutrition",
    title: "Nutrition that\nfits your goals.",
    subtitle: "Balanced meals with the calories and protein you need.",
    art: images.onboardingArtNutrition,
    artRatio: 1052 / 1074,
  },
  {
    id: "progress",
    title: "Your goals,\none meal at a time.",
    subtitle: "Choose your meals, track your progress, feel your best.",
    art: images.onboardingArtProgress,
    artRatio: 1024 / 1081,
  },
];
