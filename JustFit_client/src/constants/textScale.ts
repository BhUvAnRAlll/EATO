// Text no longer grows with the phone's text-size setting (the owner's choice, 2026-11-08): every
// phone shows text at the same size relative to the layout, so an Android phone set to a larger
// text size looks the same as an iPhone. Text still follows the screen width through the app's
// proportional scale (constants/uiScale.ts). Applied to every Text and TextInput by
// lib/reactNative.js.
export const MAX_FONT_SCALE = 1;
export const TEXT_BASE_WIDTH = 375;

// The largest text multiplier for a screen this wide: always 1 now (kept as a function so the
// rule lives in one place if text scaling is ever allowed again)
export function maxTextScaleFor(width: number): number {
  return Math.min(MAX_FONT_SCALE, Math.max(1, width / TEXT_BASE_WIDTH));
}
