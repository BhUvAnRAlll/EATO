import { useId } from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { useThemeColors } from "@/theme";

// The gym portal's indigo-to-violet gradient behind a filled control. Put it first inside the
// control (it fills it, behind the label). `radius` rounds it to the control's corners: the fill's
// own view is clipped to that radius (the control itself isn't, so it keeps its shadow). A large
// radius makes a pill or a circle. The rounding is the view's, not the SVG's: SVG halves an
// oversized rx and ry separately, which drew an ellipse inside small pills ("All · 21") and left
// lighter corners around it.
export function GradientFill({ radius }: { radius: number }) {
  const colors = useThemeColors();
  // Each fill needs its own gradient id (SVG ids are global on the web)
  const id = `gym-grad-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <View className="absolute inset-0" style={{ borderRadius: radius, overflow: "hidden" }} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.gymGradFrom} />
            <Stop offset="1" stopColor={colors.gymGradTo} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
