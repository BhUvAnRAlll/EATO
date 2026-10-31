import googleLogo from "../../assets/images/google-logo.png";
import justfitLogo from "../../assets/images/justfit-logo.png";
import onboardingArtMeals from "../../assets/images/onboarding-art-meals.png";
import onboardingArtNutrition from "../../assets/images/onboarding-art-nutrition.png";
import onboardingArtProgress from "../../assets/images/onboarding-art-progress.png";
import authSignupBowl from "../../assets/images/auth-signup-bowl.png";
import authSignupBottomLeft from "../../assets/images/auth-signup-bottom-left.png";
import authLeafLeft from "../../assets/images/auth-leaf-left.png";
import authLeafBottomRight from "../../assets/images/auth-leaf-bottom-right.png";
import authLoginArt from "../../assets/images/auth-login-art.png";
import bodySilhouette from "../../assets/images/body-silhouette.png";
import homeHeroBowl from "../../assets/images/home-hero-bowl.jpg";
import homeHeroMeals from "../../assets/images/home-hero-meals.jpg";
import homeHeroNutrition from "../../assets/images/home-hero-nutrition.jpg";
import homeHeroDelivery from "../../assets/images/home-hero-delivery.jpg";
import homeMealGrilledChicken from "../../assets/images/home-meal-grilled-chicken.jpg";
import homeMealPaneerTikka from "../../assets/images/home-meal-paneer-tikka.jpg";
import homeMealSalmon from "../../assets/images/home-meal-salmon.jpg";
import homeMealLemonHerbChicken from "../../assets/images/home-meal-lemon-herb-chicken.jpg";
import coachArjunFace from "../../assets/images/coach-arjun-face.jpg";
import coachPriyaFace from "../../assets/images/coach-priya-face.jpg";
import coachMeeraFace from "../../assets/images/coach-meera-face.jpg";
import coachRohanFace from "../../assets/images/coach-rohan-face.jpg";
import coachAdityaFace from "../../assets/images/coach-aditya-face.jpg";

import type { CoachId } from "@/data/coach";

export const images = {
  googleLogo,
  justfitLogo,
  onboardingArtMeals,
  onboardingArtNutrition,
  onboardingArtProgress,
  authSignupBowl,
  authSignupBottomLeft,
  authLeafLeft,
  authLeafBottomRight,
  authLoginArt,
  bodySilhouette,
};

// Images the home screen content can refer to as "asset:<key>" (promotions and meals
// saved by admins). The server allows exactly these keys (BUNDLED_IMAGES in
// JustFit_server/home.js); keep the two lists in sync.
export const homeImages = {
  "hero-bowl": homeHeroBowl,
  "hero-meals": homeHeroMeals,
  "hero-nutrition": homeHeroNutrition,
  "hero-delivery": homeHeroDelivery,
  "meal-grilled-chicken": homeMealGrilledChicken,
  "meal-paneer-tikka": homeMealPaneerTikka,
  "meal-salmon": homeMealSalmon,
  "meal-lemon-herb-chicken": homeMealLemonHerbChicken,
};

export type HomeImageKey = keyof typeof homeImages;

export const homeImageKeys = Object.keys(homeImages) as HomeImageKey[];

// The AI coaches' face photos, for every round avatar (CoachAvatar). A coach without one would
// show their initial.
export const coachFaces: Partial<Record<CoachId, typeof coachArjunFace>> = {
  arjun: coachArjunFace,
  priya: coachPriyaFace,
  meera: coachMeeraFace,
  rohan: coachRohanFace,
  aditya: coachAdityaFace,
};
