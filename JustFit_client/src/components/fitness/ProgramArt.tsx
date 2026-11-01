import { memo } from "react";
import { View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { SymbolView } from "@/components/SymbolView";
import { programIcon } from "@/data/fitness";
import { programGradients, useThemeColors } from "@/theme";

type ProgramArtProps = { palette: string; icon: string; iconSize: number; id: string };

// A program card's picture until real photos exist: the palette's gradient, two soft circles for
// depth and the program's symbol, large and faint, in the top-right corner. Fills its parent.
function ProgramArtBase({ palette, icon, iconSize, id }: ProgramArtProps) {
  const colors = useThemeColors();
  const [from, to] = programGradients[palette] ?? programGradients.lavender;
  // Each card's gradient needs its own id (SVG ids are global on the web)
  const gradientId = `program-${id.replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <View className="absolute inset-0" pointerEvents="none">
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
        <Circle cx="88%" cy="18%" r="34%" fill={colors.white} fillOpacity={0.1} />
        <Circle cx="8%" cy="100%" r="40%" fill={colors.black} fillOpacity={0.08} />
      </Svg>
      <View className="absolute right-3 top-3" style={{ opacity: 0.9 }}>
        <SymbolView name={programIcon(icon)} size={iconSize} tintColor={colors.white} />
      </View>
    </View>
  );
}

export const ProgramArt = memo(ProgramArtBase);
