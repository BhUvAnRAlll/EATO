import type { NativeStackNavigationOptions } from "expo-router";

// Swipe back, the same in every stack (spread into each layout's screenOptions).
// iOS: the native swipe from the left edge, with its interactive animation. Edge only on every iOS
// version: iOS 26 would otherwise let a swipe anywhere on the screen go back, which takes over
// horizontal drags meant for charts, carousels and sliders. Scroll views never block the edge swipe.
// Android: the system back gesture (and predictive back, app.json) pops the stack; these options are
// iOS-only there, so Android is unchanged by them.
export const swipeBack: NativeStackNavigationOptions = {
  gestureEnabled: true,
  fullScreenGestureEnabled: false,
};
