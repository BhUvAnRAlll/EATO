import type { ImageSourcePropType } from "react-native";
import type { SymbolViewProps } from "expo-symbols";

import { images } from "@/constants/images";

type Icon = SymbolViewProps["name"];

export type OnboardingSlide = {
  id: string;
  image: ImageSourcePropType;
  tag: { label: string; icon: Icon };
  features: { label: string; icon: Icon }[];
  overline: string;
  title: string;
  body: string;
  footer: string;
};

export const onboardingSlides: OnboardingSlide[] = [
  {
    id: "meals",
    image: images.onboardingMeals,
    tag: {
      label: "High-protein meals",
      icon: { ios: "fork.knife", android: "restaurant", web: "restaurant" },
    },
    features: [
      { label: "Fresh Ingredients", icon: { ios: "leaf.fill", android: "eco", web: "eco" } },
      {
        label: "High Protein",
        icon: { ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" },
      },
      {
        label: "Home Delivery",
        icon: { ios: "box.truck.fill", android: "local_shipping", web: "local_shipping" },
      },
    ],
    overline: "Welcome to EATO",
    title: "Healthy meals\nfor a stronger you.",
    body: "Delicious, high-protein meals delivered to your home. Designed for your fitness goals, with clean ingredients and real nutrition.",
    footer: "Fresh meals. Delivered daily.",
  },
  {
    id: "plans",
    image: images.onboardingPlans,
    tag: {
      label: "Customized plans",
      icon: { ios: "leaf.fill", android: "eco", web: "eco" },
    },
    features: [
      { label: "Your Goals", icon: { ios: "scope", android: "track_changes", web: "track_changes" } },
      {
        label: "Balanced Nutrition",
        icon: { ios: "chart.bar.fill", android: "bar_chart", web: "bar_chart" },
      },
      {
        label: "Dietitian Approved",
        icon: { ios: "frying.pan.fill", android: "chef_hat", web: "chef_hat" },
      },
    ],
    overline: "Nutrition made simple",
    title: "Personalized meal\nplans for your goals.",
    body: "Tell us your goal, we create customized meal plans with the right calories, protein, carbs and fats. Fresh, healthy and tasty meals delivered to you.",
    footer: "Real food. Real results.",
  },
  {
    id: "progress",
    image: images.onboardingProgress,
    tag: {
      label: "Track your progress",
      icon: { ios: "chart.bar.fill", android: "bar_chart", web: "bar_chart" },
    },
    features: [
      {
        label: "Photo Tracking",
        icon: { ios: "camera.fill", android: "photo_camera", web: "photo_camera" },
      },
      {
        label: "Calories & Macros",
        icon: { ios: "chart.bar.fill", android: "bar_chart", web: "bar_chart" },
      },
      {
        label: "Weekly Insights",
        icon: { ios: "chart.line.uptrend.xyaxis", android: "trending_up", web: "trending_up" },
      },
    ],
    overline: "Track. Improve. Transform.",
    title: "Stay consistent\nand see real results.",
    body: "Log your calories, protein, meals and water. Get AI insights and stay consistent with your fitness goals.",
    footer: "Healthier meals. A stronger you.",
  },
];
