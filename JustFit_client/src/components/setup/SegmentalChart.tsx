import { useState } from "react";
import { Animated, Text, View, type LayoutChangeEvent } from "react-native";
import { Image } from "expo-image";
import { SymbolView } from "@/components/SymbolView";

import { useGrow } from "@/components/setup/ReportGraphs";
import { images } from "@/constants/images";
import type { BodySegment, SegmentRating, SegmentReading } from "@/lib/nutrition";
import type { Icon } from "@/types/profile";
import { colors } from "@/theme";

type SegmentalChartProps = {
  title: string;
  icon: Icon;
  // Icon colour and the soft tile behind it
  tint: string;
  background: string;
  readings: Record<BodySegment, SegmentReading>;
  // The callouts fade in one after another, starting after this many ms
  delay?: number;
  // As in a photo of someone facing you: their right arm and leg on the viewer's left
  // (the body scan's convention). Off by default, the sheet's: their left on the viewer's left.
  mirrored?: boolean;
};

const mirror: Record<BodySegment, BodySegment> = { leftArm: "rightArm", rightArm: "leftArm", leftLeg: "rightLeg", rightLeg: "leftLeg", trunk: "trunk" };

// Width ÷ height of the silhouette image (the figure from the design mockup)
const SILHOUETTE_RATIO = 501 / 900;
// Panel height as a share of its width
const PANEL_RATIO = 1.02;

const ratingColors: Record<SegmentRating, string> = {
  normal: "#2F9E4F",
  under: "#F08A3E",
  over: colors.danger,
};
const ratingLabels: Record<SegmentRating, string> = { normal: "Normal", under: "Under", over: "Over" };
const segmentLabels: Record<BodySegment, string> = { leftArm: "Left Arm", rightArm: "Right Arm", trunk: "Trunk", leftLeg: "Left Leg", rightLeg: "Right Leg" };

type Point = { x: number; y: number };

// Where each callout sits and where its line meets the body, as shares of the panel size
// (the viewer's left is the person's left arm, as on the sheet's diagram)
const callouts: { segment: BodySegment; side: "left" | "right"; top: number; dot: Point; body: Point }[] = [
  { segment: "leftArm", side: "left", top: 0.1, dot: { x: 0.26, y: 0.2 }, body: { x: 0.385, y: 0.31 } },
  { segment: "rightArm", side: "right", top: 0.1, dot: { x: 0.74, y: 0.2 }, body: { x: 0.615, y: 0.31 } },
  { segment: "leftLeg", side: "left", top: 0.62, dot: { x: 0.26, y: 0.72 }, body: { x: 0.44, y: 0.78 } },
  { segment: "rightLeg", side: "right", top: 0.62, dot: { x: 0.74, y: 0.72 }, body: { x: 0.56, y: 0.78 } },
];
const trunkBody: Point = { x: 0.5, y: 0.36 };
const trunkBox: Point = { x: 0.5, y: 0.52 };

function Dot({ at, color }: { at: Point; color: string }) {
  return <View style={{ position: "absolute", left: at.x - 4, top: at.y - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />;
}

// A straight line from `from` to `to`, drawn as a thin rotated View
function Line({ from, to, color }: { from: Point; to: Point; color: string }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (
    <View
      style={{
        position: "absolute",
        left: from.x,
        top: from.y - 0.75,
        width: length,
        height: 1.5,
        backgroundColor: color,
        transformOrigin: "0% 50%",
        transform: [{ rotate: `${angle}deg` }],
      }}
    />
  );
}

function Reading({ reading, segment, align }: { reading: SegmentReading; segment: BodySegment; align: "left" | "right" | "center" }) {
  const color = reading.rating ? ratingColors[reading.rating] : colors.muted;
  const textAlign = align;
  return (
    <>
      <Text className="seg__value" style={{ textAlign }}>
        {reading.kg != null ? reading.kg : "—"}
        {reading.kg != null && <Text className="seg__value-unit"> kg</Text>}
      </Text>
      <Text className="seg__rating" style={{ color, textAlign }}>
        {reading.rating ? ratingLabels[reading.rating] : "Not rated"}
      </Text>
      <Text className="seg__label" style={{ textAlign }}>
        {segmentLabels[segment]}
      </Text>
    </>
  );
}

// One analysis (lean mass or fat): a body silhouette with a callout per region. Every
// position is a share of the panel size, so it scales with the phone.
export function SegmentalChart({ title, icon, tint, background, readings, delay = 0, mirrored = false }: SegmentalChartProps) {
  // One fade per callout (left arm, right arm, left leg, right leg), then the trunk
  const appear = [useGrow(delay), useGrow(delay + 120), useGrow(delay + 240), useGrow(delay + 360), useGrow(delay + 480)];
  const fadeIn = (grow: Animated.Value) => ({
    position: "absolute" as const,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    opacity: grow,
    transform: [{ translateY: grow.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
  });
  const [width, setWidth] = useState(0);
  const height = Math.round(width * PANEL_RATIO);
  const silhouetteHeight = Math.round(height * 0.9);
  const silhouetteWidth = Math.round(silhouetteHeight * SILHOUETTE_RATIO);
  const at = (point: Point): Point => ({ x: point.x * width, y: point.y * height });
  const labelWidth = Math.round(width * 0.26);
  // Wide enough for "Not rated" on one line even on the narrowest phones
  const trunkWidth = Math.max(100, Math.round(width * 0.3));
  const trunkColor = readings.trunk.rating ? ratingColors[readings.trunk.rating] : colors.muted;

  return (
    <View className="seg__card">
      <View className="flex-row items-center gap-3">
        <View className="review__icon" style={{ backgroundColor: background }}>
          <SymbolView name={icon} size={20} tintColor={tint} />
        </View>
        <Text className="seg__title" numberOfLines={2}>
          {title}
        </Text>
        <Text className="seg__unit">Unit: kg</Text>
      </View>

      <View className="seg__panel mt-3" style={{ height: width > 0 ? height : undefined }} onLayout={(event: LayoutChangeEvent) => setWidth(Math.round(event.nativeEvent.layout.width))}>
        {width > 0 && (
          <>
            <Image
              source={images.bodySilhouette}
              contentFit="contain"
              style={{ position: "absolute", left: (width - silhouetteWidth) / 2, top: (height - silhouetteHeight) / 2, width: silhouetteWidth, height: silhouetteHeight }}
              accessibilityLabel="Body outline"
            />

            {callouts.map(({ segment: placed, side, top, dot, body }, index) => {
              const segment = mirrored ? mirror[placed] : placed;
              const reading = readings[segment];
              const color = reading.rating ? ratingColors[reading.rating] : colors.sand;
              return (
                <Animated.View key={segment} style={fadeIn(appear[index])} pointerEvents="none">
                  <Line from={at(dot)} to={at(body)} color={color} />
                  <Dot at={at(dot)} color={color} />
                  <Dot at={at(body)} color={color} />
                  <View style={{ position: "absolute", top: top * height, width: labelWidth, [side]: Math.round(width * 0.04), alignItems: side === "left" ? "flex-start" : "flex-end" }}>
                    <Reading reading={reading} segment={segment} align={side} />
                  </View>
                </Animated.View>
              );
            })}

            {/* Trunk: a small box on the body, joined to its measuring point */}
            <Animated.View style={fadeIn(appear[4])} pointerEvents="none">
              <Line from={at(trunkBody)} to={{ x: trunkBox.x * width, y: trunkBox.y * height - 30 }} color={trunkColor} />
              <Dot at={at(trunkBody)} color={trunkColor} />
              <View className="seg__trunk" style={{ position: "absolute", left: trunkBox.x * width - trunkWidth / 2, top: trunkBox.y * height - 30, width: trunkWidth }}>
                <Reading reading={readings.trunk} segment="trunk" align="center" />
              </View>
            </Animated.View>
          </>
        )}
      </View>
    </View>
  );
}
