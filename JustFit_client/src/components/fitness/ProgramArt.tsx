import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { SymbolView } from "@/components/SymbolView";
import { programIcon } from "@/data/fitness";
import { getApiUrl } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { programGradients, useThemeColors } from "@/theme";

type ProgramArtProps = { palette: string; icon: string; iconSize: number; id: string; coverUrl?: string | null; shade?: boolean };

// A program card's picture: the cover photo the admin uploaded, when there is one, with a soft
// shade at the bottom so the white title on top stays readable (`shade={false}` when nothing is
// written on it); otherwise the palette's gradient,
// two soft circles for depth and the program's symbol, large and faint, in the top-right corner
// (none when `iconSize` is 0).
// The gradient also shows while the photo loads. Fills its parent.
function ProgramArtBase({ palette, icon, iconSize, id, coverUrl, shade = true }: ProgramArtProps) {
  const colors = useThemeColors();
  const token = useAuthStore((state) => state.token);
  const [from, to] = programGradients[palette] ?? programGradients.lavender;
  // Each card's gradient needs its own id (SVG ids are global on the web)
  const gradientId = `program-${id.replace(/[^a-zA-Z0-9]/g, "")}`;
  const shadeId = `${gradientId}-shade`;
  // The cover is read from the server with the session token (it is never public)
  const cover = coverUrl && token ? { uri: `${getApiUrl()}${coverUrl}`, headers: { Authorization: `Bearer ${token}` }, cacheKey: coverUrl } : null;
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
        {!cover && <Circle cx="88%" cy="18%" r="34%" fill={colors.white} fillOpacity={0.1} />}
        {!cover && <Circle cx="8%" cy="100%" r="40%" fill={colors.black} fillOpacity={0.08} />}
      </Svg>
      {cover ? (
        <>
          <Image source={cover} contentFit="cover" transition={150} style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors />
          {shade && (
            <View className="absolute inset-0">
              <Svg width="100%" height="100%" preserveAspectRatio="none">
                <Defs>
                  <LinearGradient id={shadeId} x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0.35" stopColor={colors.black} stopOpacity={0} />
                    <Stop offset="1" stopColor={colors.black} stopOpacity={0.55} />
                  </LinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${shadeId})`} />
              </Svg>
            </View>
          )}
        </>
      ) : iconSize > 0 ? (
        <View className="absolute right-3 top-3" style={{ opacity: 0.9 }}>
          <SymbolView name={programIcon(icon)} size={iconSize} tintColor={colors.white} />
        </View>
      ) : null}
    </View>
  );
}

export const ProgramArt = memo(ProgramArtBase);
