import { useWindowDimensions } from "react-native";

import { layoutSize, scaled, textWidth, type LayoutSize } from "@/lib/responsiveRules";

export type Responsive = {
  width: number;
  // The width in text units (width ÷ text size): what layout decisions compare against
  units: number;
  size: LayoutSize;
  compact: boolean;
  // compact or regular: dense rows stack below the wide size
  narrow: boolean;
  // A component size in proportion to the screen, within bounds (see lib/responsiveRules.ts)
  scale: (size: number, bounds?: { min?: number; max?: number }) => number;
};

// The screen's responsive state, updated on rotation, split screen and text-size changes. Use it
// for every layout decision that depends on space, never a raw width check (2026-11-08).
export function useResponsive(): Responsive {
  const { width, fontScale } = useWindowDimensions();
  const size = layoutSize(width, fontScale);
  return {
    width,
    units: textWidth(width, fontScale),
    size,
    compact: size === "compact",
    narrow: size !== "wide",
    scale: (value, bounds) => scaled(value, width, bounds),
  };
}
