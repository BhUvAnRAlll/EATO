import type { ReactNode } from "react";
import { View } from "react-native";

import { colors } from "@/theme";

type RingProps = {
  size: number;
  stroke: number;
  // 0–1 (anything above 1 draws a full ring)
  progress: number;
  color: string;
  trackColor?: string;
  // A dashed track for "nothing logged"
  dashed?: boolean;
  // Round ends on the arc (off for the segments of a split donut, which must butt together)
  caps?: boolean;
  children?: ReactNode;
};

// A progress ring drawn with plain Views (no SVG library), the same technique as the home
// screen's rings: a half-circle border rotated into place, clipped to the right half for
// the first 180° and to the left half beyond that, with round caps at both ends.
export function Ring({ size, stroke, progress, color, trackColor = colors.creamLine, dashed = false, caps = true, children }: RingProps) {
  const angle = Math.min(1, Math.max(0, progress)) * 360;
  const radius = (size - stroke) / 2;

  const halfCircle = (rotate: number) => (
    <View
      style={{
        position: "absolute",
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: stroke,
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
          width: stroke,
          height: stroke,
          borderRadius: stroke / 2,
          backgroundColor: color,
          left: size / 2 + radius * Math.sin(radians) - stroke / 2,
          top: size / 2 - radius * Math.cos(radians) - stroke / 2,
        }}
      />
    );
  };

  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      <View
        style={{ position: "absolute", width: size, height: size, borderRadius: size / 2, borderWidth: dashed ? Math.max(1.5, stroke / 3) : stroke, borderColor: trackColor, borderStyle: dashed ? "dashed" : "solid" }}
      />
      {angle > 0 && (
        <View style={{ position: "absolute", left: size / 2, top: 0, width: size / 2, height: size, overflow: "hidden" }}>
          <View style={{ position: "absolute", left: -size / 2, top: 0 }}>{halfCircle(Math.min(angle, 180) - 135)}</View>
        </View>
      )}
      {angle > 180 && (
        <View style={{ position: "absolute", left: 0, top: 0, width: size / 2, height: size, overflow: "hidden" }}>
          <View style={{ position: "absolute", left: 0, top: 0 }}>{halfCircle(angle - 135)}</View>
        </View>
      )}
      {caps && angle > 0 && angle < 360 && cap(0)}
      {caps && angle > 0 && angle < 360 && cap(angle)}
      {children}
    </View>
  );
}
