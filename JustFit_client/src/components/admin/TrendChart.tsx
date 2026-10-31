import { useMemo, useState } from "react";
import { PanResponder, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from "react-native-svg";

import { colors } from "@/theme";

type Point = { key: string; value: number };

type Props = {
  points: Point[];
  // How a value reads: in the readout, on the peak and in the accessibility label
  format: (value: number) => string;
  // A short label under a point; return "" to leave it out (every nth for dense charts)
  label: (key: string, index: number) => string;
  // The full name of a point's day for the readout ("Mon 27 Oct")
  describe?: (key: string) => string;
  color: string;
  height?: number;
};

const PAD = { top: 22, right: 12, bottom: 4, left: 30 };
const SURFACE = colors.surface;

// Clean y-axis steps: 0, half and the top. Counts are whole numbers, so the top is even up to
// 10 (its half is whole too), then 2, 5 or 10 × 10ⁿ above that.
function niceTop(max: number) {
  if (max <= 10) return Math.max(2, Math.ceil(max / 2) * 2);
  const pow = 10 ** Math.floor(Math.log10(max));
  const unit = max / pow;
  const step = unit <= 2 ? 2 : unit <= 5 ? 5 : 10;
  return step * pow;
}

// One series over time as an area chart: a 2px line over a light wash, hairline gridlines with
// rounded ticks, the peak labelled, and a finger on the plot reads any day's value. Plain SVG,
// no chart library. The days are listed in the accessibility label and in the Daily CSV export.
export function TrendChart({ points, format, label, describe, color, height = 160 }: Props) {
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const plotLeft = PAD.left;
  const plotRight = Math.max(width - PAD.right, plotLeft + 1);
  const plotTop = PAD.top;
  const plotBottom = height - PAD.bottom;
  const top = niceTop(Math.max(...points.map((p) => p.value), 0));
  const stepX = points.length > 1 ? (plotRight - plotLeft) / (points.length - 1) : 0;
  const xOf = (i: number) => (points.length > 1 ? plotLeft + i * stepX : (plotLeft + plotRight) / 2);
  const yOf = (v: number) => plotBottom - (v / top) * (plotBottom - plotTop);

  // The finger's x → the nearest day; the responder is rebuilt when the plot's geometry changes
  const count = points.length;
  const pan = useMemo(() => {
    const pick = (x: number) => {
      if (count === 0) return;
      const i = stepX > 0 ? Math.round((x - plotLeft) / stepX) : 0;
      setPicked(Math.min(Math.max(i, 0), count - 1));
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => pick(e.nativeEvent.locationX),
      onPanResponderMove: (e) => pick(e.nativeEvent.locationX),
      onPanResponderRelease: () => setPicked(null),
      onPanResponderTerminate: () => setPicked(null),
    });
  }, [count, stepX, plotLeft]);

  const peak = points.reduce((best, p, i) => (p.value > points[best].value ? i : best), 0);
  const hasData = points.some((p) => p.value > 0);
  const dense = points.length > 31;
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(" ");
  const areaPath = points.length > 1 ? `${linePath} L${xOf(points.length - 1).toFixed(1)},${plotBottom} L${xOf(0).toFixed(1)},${plotBottom} Z` : "";
  const ticks = [0, top / 2, top];
  const shown = picked ?? (hasData ? peak : null);
  const shownPoint = shown === null ? null : points[shown];
  const readoutX = shown === null ? 0 : Math.min(Math.max(xOf(shown) - 48, plotLeft), Math.max(plotRight - 96, plotLeft));

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="image"
      accessibilityLabel={points.map((p, i) => `${describe?.(p.key) ?? label(p.key, i) ?? p.key}: ${format(p.value)}`).join(", ")}
    >
      <View style={{ height }} {...pan.panHandlers}>
        {width > 0 && (
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id="trend-wash" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={color} stopOpacity={0.16} />
                <Stop offset="1" stopColor={color} stopOpacity={0.02} />
              </LinearGradient>
            </Defs>
            {ticks.map((t) => (
              <Line key={t} x1={plotLeft} x2={plotRight} y1={yOf(t)} y2={yOf(t)} stroke={colors.line} strokeWidth={1} />
            ))}
            {hasData && areaPath !== "" && <Path d={areaPath} fill="url(#trend-wash)" />}
            {hasData && <Path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
            {hasData && !dense && points.map((p, i) => (
              <Circle key={p.key} cx={xOf(i)} cy={yOf(p.value)} r={3.5} fill={color} stroke={SURFACE} strokeWidth={2} />
            ))}
            {shown !== null && (
              <>
                <Line x1={xOf(shown)} x2={xOf(shown)} y1={plotTop - 4} y2={plotBottom} stroke={picked === null ? colors.lineStrong : color} strokeWidth={1} />
                <Circle cx={xOf(shown)} cy={yOf(points[shown].value)} r={5.5} fill={color} stroke={SURFACE} strokeWidth={2} />
              </>
            )}
          </Svg>
        )}
        {ticks.map((t) => (
          <Text key={t} className="trend__tick" style={{ top: yOf(t) - 7 }} numberOfLines={1}>{t >= 1000 ? `${t / 1000}K` : String(t)}</Text>
        ))}
        {shownPoint && (
          <View className={picked === null ? "trend__readout" : "trend__readout trend__readout--live"} style={{ left: readoutX }} pointerEvents="none">
            <Text className="trend__readout-value" numberOfLines={1}>{format(shownPoint.value)}</Text>
            <Text className="trend__readout-day" numberOfLines={1}>{describe?.(shownPoint.key) ?? shownPoint.key}</Text>
          </View>
        )}
      </View>
      <View style={{ height: 16 }}>
        {width > 0 && points.map((p, i) => {
          const text = label(p.key, i);
          if (!text) return null;
          return (
            <Text key={p.key} className="trend__label" style={{ left: xOf(i) - 24 }} numberOfLines={1}>{text}</Text>
          );
        })}
      </View>
    </View>
  );
}
