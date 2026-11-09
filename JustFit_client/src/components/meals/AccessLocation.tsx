import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View, useWindowDimensions } from "react-native";
import Svg, { Circle, ClipPath, Defs, G, Line, LinearGradient, Path, Rect, Stop } from "react-native-svg";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { findMe, openLocationSettings } from "@/lib/deliveryLocation";
import type { LatLng } from "@/lib/addressRules";
import { useThemeColors } from "@/theme";

type Props = {
  // The phone found where the member is: open the map there
  onFound: (at: LatLng) => void;
  // Skip GPS and pick the place on the map or by search
  onManual: () => void;
};

// The Meals tab's first screen for a member with no delivery address (the user's reference,
// 2026-11-09, in justFit green): a map drawing with the pin, Access Location (asks for the
// phone's location while the app is in use) and the note that it's only while using the app.
export function AccessLocation({ onFound, onManual }: Props) {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const [finding, setFinding] = useState(false);
  const [problem, setProblem] = useState<{ text: string; settings: boolean } | null>(null);
  const size = Math.round(Math.min(300, width - 72));

  const access = async () => {
    if (finding) return;
    setFinding(true);
    setProblem(null);
    const found = await findMe();
    setFinding(false);
    if (found.ok) onFound(found.at);
    else setProblem({ text: found.message, settings: found.settings });
  };

  return (
    <View className="access-location">
      <MapArt size={size} />
      <View className="w-full" style={{ gap: 32, marginTop: 46 }}>
        <PressableScale haptic="tap" scaleTo={0.98} onPress={access} disabled={finding} className="access-location__button" accessibilityRole="button" accessibilityLabel="Access location" accessibilityState={{ busy: finding }}>
          <Text className="access-location__button-label">Access location</Text>
          <View className="access-location__button-icon">
            {finding ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <SymbolView name={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" }} size={16} tintColor={colors.onPrimary} />}
          </View>
        </PressableScale>
        {problem ? (
          <View style={{ gap: 10 }} accessibilityLiveRegion="polite">
            <Text className="access-location__problem">{problem.text}</Text>
            {problem.settings && (
              <Pressable onPress={openLocationSettings} hitSlop={8} accessibilityRole="button" className="self-center">
                <Text className="meal-link">Open Settings</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <Text className="access-location__note">justFit will access your location only while using the app</Text>
        )}
        <Pressable onPress={onManual} hitSlop={10} accessibilityRole="button" className="self-center">
          <Text className="meal-link">Enter address manually</Text>
        </Pressable>
      </View>
    </View>
  );
}

// The map drawing: a round street map (pale ground, faint blocks, yellow roads, a green park)
// with the justFit-green pin and its shadow. Drawn, not an image, so it stays sharp at any size.
function MapArt({ size }: { size: number }) {
  const colors = useThemeColors();
  const grid = [40, 80, 120, 160, 200, 240, 280];
  return (
    <Svg width={size} height={size} viewBox="0 0 300 300" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <ClipPath id="accessLocationCircle">
          <Circle cx={150} cy={150} r={150} />
        </ClipPath>
        <LinearGradient id="accessLocationShadow" x1="0" y1="1" x2="1" y2="0">
          <Stop offset="0" stopColor={colors.ink} stopOpacity={0.32} />
          <Stop offset="1" stopColor={colors.ink} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <G clipPath="url(#accessLocationCircle)">
        <Rect x={0} y={0} width={300} height={300} fill={colors.surfaceAlt} />
        <G rotate={-22} origin="150, 150">
          {grid.map((at) => (
            <G key={at}>
              <Line x1={at - 40} y1={-80} x2={at - 40} y2={380} stroke={colors.surface} strokeWidth={1.5} />
              <Line x1={-80} y1={at - 40} x2={380} y2={at - 40} stroke={colors.surface} strokeWidth={1.5} />
            </G>
          ))}
          <Path d="M170 -80 L330 -80 L330 60 Q240 40 196 -10 Z" fill={colors.protein} opacity={0.7} />
          <Rect x={52} y={-80} width={22} height={460} fill={colors.fat} opacity={0.6} />
          <Rect x={206} y={-80} width={22} height={460} fill={colors.fat} opacity={0.6} />
          <Rect x={-80} y={62} width={460} height={22} fill={colors.fat} opacity={0.6} />
          <Rect x={-80} y={212} width={460} height={22} fill={colors.fat} opacity={0.6} />
          <Path d="M228 300 Q236 246 300 234" stroke={colors.fat} strokeOpacity={0.6} strokeWidth={14} fill="none" />
        </G>
      </G>
      {/* The pin's shadow falls to the lower right */}
      <Path d="M150 228 L190 150 L246 166 L206 210 Z" fill="url(#accessLocationShadow)" />
      <Path d="M150 230 C142 204 104 176 104 128 A46 46 0 1 1 196 128 C196 176 158 204 150 230 Z" fill={colors.primary} />
      <Circle cx={150} cy={128} r={14} fill={colors.surface} />
    </Svg>
  );
}
