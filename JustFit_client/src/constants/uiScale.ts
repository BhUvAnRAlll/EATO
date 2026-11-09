// The whole app is laid out for a phone at least UI_DESIGN_WIDTH points wide and, on a narrower
// screen, shrunk evenly to fit: text, buttons, cards, icons and images keep the same proportions
// as on a standard phone instead of the layout being rearranged (the owner's choice, 2026-11-08:
// "if the width is less, reduce the size of components, buttons and UI"). Wider phones are never
// enlarged. Applied by lib/reactNative.js (UiScaleRoot, Modal, useWindowDimensions, Keyboard).
// The iPhone 15 Plus's width: every narrower phone shows the same layout as that phone, shrunk
// to fit (the owner's reference phone, 2026-11-08)
export const UI_DESIGN_WIDTH = 430;
// Never shrink below this, so text stays readable on the smallest phones (a 320-wide phone would
// need 0.74; it stops here and uses a little more of the layout's compact rules instead)
export const UI_MIN_SCALE = 0.8;

export function uiScaleFor(width: number): number {
  if (!(width > 0)) return 1;
  return Math.min(1, Math.max(UI_MIN_SCALE, width / UI_DESIGN_WIDTH));
}
