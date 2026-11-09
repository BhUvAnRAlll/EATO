// justFit's responsive sizing rules (2026-11-08, the owner's "every screen on every phone" brief).
// Pure and unit-tested; screens use them through useResponsive() in lib/responsive.ts.
//
// Two ideas:
// 1. Layout decisions (stack or side by side, 1 or 2 columns) are made in "text units": the screen
//    width divided by the text size the phone uses (capped at the app's 1.3× limit). A 360-wide
//    Android phone at its default 1.15 text behaves like a 313-wide one, and an iPhone with larger
//    Dynamic Type the same way, so one rule covers both platforms and every model.
// 2. Component sizes (rings, avatars, icon tiles, hero cards) follow the screen width from a
//    390-point design base, kept between a minimum and a maximum so nothing is cramped on a small
//    phone or blown up on a large one. Text sizes don't scale this way: they follow the phone's
//    own text setting.

export const DESIGN_WIDTH = 390;
// constants/textScale.ts: text doesn't follow the phone's text-size setting
export const MAX_TEXT_SCALE = 1;
// constants/textScale.ts: text doesn't grow on phones narrower than this
export const TEXT_BASE_WIDTH = 375;

// Every phone from 355 text units up gets the same layout (the owner's request, 2026-11-08: iPhone
// and Android the same; narrower means smaller, not rearranged). Only really small screens or very
// large text rearrange: below WIDE dense rows (side buttons, dates beside titles) stack, below
// COMPACT tiles also go two to a line.
export const COMPACT = 340;
export const WIDE = 355;

export type LayoutSize = "compact" | "regular" | "wide";

// The text size the app really uses: the phone's setting, limited by maxTextScaleFor(width)
export function textWidth(width: number, fontScale: number): number {
  const scale = Math.min(Math.max(fontScale || 1, 0.5), MAX_TEXT_SCALE, Math.max(1, width / TEXT_BASE_WIDTH));
  return width / scale;
}

export function layoutSize(width: number, fontScale: number): LayoutSize {
  const units = textWidth(width, fontScale);
  if (units < COMPACT) return "compact";
  if (units < WIDE) return "regular";
  return "wide";
}

// A component size for this screen: `size` at the 390-point design width, in proportion to the
// screen, never under `min` (default 85% of size) or over `max` (default 115%), in whole points.
export function scaled(size: number, width: number, bounds: { min?: number; max?: number } = {}): number {
  const min = bounds.min ?? Math.round(size * 0.85);
  const max = bounds.max ?? Math.round(size * 1.15);
  return Math.round(Math.min(max, Math.max(min, (size * width) / DESIGN_WIDTH)));
}
