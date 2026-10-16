import { Text, View } from "react-native";
import { SymbolView } from "expo-symbols";

import type { Icon } from "@/types/profile";

type CircularNutritionProgressProps = {
  label: string;
  value: number;
  target: number;
  // Shown after the target, e.g. "kcal" or "g"
  unit: string;
  color: string;
  icon: Icon;
  size: number;
};

const STROKE = 8;

// Font size that keeps `text` on one line inside the ring's hole. Average glyph widths
// (as a share of the font size) are rough but safe for digits, commas and "of"/"g".
function fitFontSize(text: string, preferred: number, maxWidth: number, glyphWidth: number) {
  return Math.min(preferred, Math.floor(maxWidth / (text.length * glyphWidth)));
}

// A progress ring drawn with plain Views (no SVG library). The track is a circle with a
// border. The arc is a circle whose top and right borders are coloured (a half circle
// once rotated 45°), clipped to the right half of the ring, plus a second one clipped
// to the left half when progress passes 50%. Small dots round the arc's ends.
export function CircularNutritionProgress({ label, value, target, unit, color, icon, size }: CircularNutritionProgressProps) {
  const progress = target > 0 ? Math.min(1, Math.max(0, value / target)) : 0;
  const angle = progress * 360;
  const radius = (size - STROKE) / 2;

  const halfCircle = (rotate: number) => (
    <View
      style={{
        position: "absolute",
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: STROKE,
        borderColor: "transparent",
        borderTopColor: color,
        borderRightColor: color,
        transform: [{ rotate: `${rotate}deg` }],
      }}
    />
  );
  // A round cap at `degrees` (0 = top, clockwise)
  const cap = (degrees: number) => {
    const radians = (degrees * Math.PI) / 180;
    return (
      <View
        style={{
          position: "absolute",
          width: STROKE,
          height: STROKE,
          borderRadius: STROKE / 2,
          backgroundColor: color,
          left: size / 2 + radius * Math.sin(radians) - STROKE / 2,
          top: size / 2 - radius * Math.cos(radians) - STROKE / 2,
        }}
      />
    );
  };

  const valueText = unit === "kcal" ? value.toLocaleString("en-IN") : `${value}g`;
  // "kcal" is left out inside the ring (the label says Calories); it would not fit the hole
  const targetText = unit === "kcal" ? `of ${target.toLocaleString("en-IN")}` : `of ${target}g`;
  // The hole inside the track, less a little breathing room
  const innerWidth = size - STROKE * 2 - 6;
  const valueSize = fitFontSize(valueText, Math.round(size * 0.24), innerWidth, 0.62);
  // Never below 10pt: the smallest rings (narrow phones) must stay readable
  const targetSize = Math.max(10, fitFontSize(targetText, Math.round(size * 0.14), innerWidth, 0.52));

  return (
    <View className="items-center" style={{ width: size }} accessibilityLabel={`${label}: ${valueText} ${targetText}${unit === "kcal" ? " kcal" : ""}`}>
      <View style={{ width: size, height: size }} className="items-center justify-center">
        {/* Track */}
        <View style={{ position: "absolute", width: size, height: size, borderRadius: size / 2, borderWidth: STROKE, borderColor: "#E9E5DD" }} />
        {/* Right half: 0° → 180° (skipped at 0%, where it would leave hairlines at the clip edges) */}
        {angle > 0 && (
          <View style={{ position: "absolute", left: size / 2, top: 0, width: size / 2, height: size, overflow: "hidden" }}>
            <View style={{ position: "absolute", left: -size / 2, top: 0 }}>{halfCircle(Math.min(angle, 180) - 135)}</View>
          </View>
        )}
        {/* Left half: 180° → 360° */}
        {angle > 180 && (
          <View style={{ position: "absolute", left: 0, top: 0, width: size / 2, height: size, overflow: "hidden" }}>
            <View style={{ position: "absolute", left: 0, top: 0 }}>{halfCircle(angle - 135)}</View>
          </View>
        )}
        {angle > 0 && angle < 360 && cap(0)}
        {angle > 0 && angle < 360 && cap(angle)}

        <SymbolView name={icon} size={Math.round(size * 0.2)} tintColor={color} />
        <Text className="ring__value" style={{ fontSize: valueSize, lineHeight: Math.round(valueSize * 1.17), maxWidth: innerWidth }} numberOfLines={1}>
          {valueText}
        </Text>
        <Text className="ring__target" style={{ fontSize: targetSize, lineHeight: Math.round(targetSize * 1.3), maxWidth: innerWidth }} numberOfLines={1}>
          {targetText}
        </Text>
      </View>
      <Text className="ring__label mt-2" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
