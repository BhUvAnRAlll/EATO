import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, Text, View } from "react-native";

import { ProgressRing } from "@/components/ProgressRing";
import { barPosition, type Range } from "@/lib/bodyScanRules";
import { useThemeColors } from "@/theme";

// Graphs for the body composition report (setup/scan-report), laid out like the scan's own
// report in justFit's light theme. Each graph animates in once when the report opens, one after
// another (`delay`), and appears at once when Reduce Motion is on.

// 0 → 1 over 700 ms, after `delay` ms (also used by the segmental chart's fade-in)
export function useGrow(delay: number) {
  const [grow] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (reduce) return grow.setValue(1);
        animation = Animated.timing(grow, { toValue: 1, duration: 700, delay, useNativeDriver: false });
        animation.start();
      });
    return () => animation?.stop();
  }, [grow, delay]);
  return grow;
}

const percent = (fraction: number): `${number}%` => `${Math.round(fraction * 1000) / 10}%`;
const widthTo = (grow: Animated.Value, fraction: number) => grow.interpolate({ inputRange: [0, 1], outputRange: ["0%", percent(fraction)] });

export type Tone = "good" | "info" | "warn" | "bad";

const pillClass: Record<Tone, string> = {
  good: "report__pill report__pill--good",
  info: "report__pill report__pill--info",
  warn: "report__pill report__pill--warn",
  bad: "report__pill report__pill--bad",
};

// A small coloured label: "Normal", "Over", "High"…
export function Pill({ label, tone }: { label: string; tone: Tone }) {
  return (
    <View className={pillClass[tone]}>
      <Text className="report__pill-label">{label}</Text>
    </View>
  );
}

// Body fat on a 0–50 % scale split into Low / Healthy / Elevated / High; the needle slides to the value
export function BodyFatGauge({ value, healthy, delay = 0 }: { value: number; healthy: Range; delay?: number }) {
  const colors = useThemeColors();
  const grow = useGrow(delay);
  const [low, high] = healthy;
  const elevated = high + 5;
  const at = (v: number) => barPosition(v, 0, 50);
  const bands = [
    { label: "Low", from: 0, to: low, className: "report__band--low" },
    { label: "Healthy", from: low, to: high, className: "report__band--healthy" },
    { label: "Elevated", from: high, to: elevated, className: "report__band--elevated" },
    { label: "High", from: elevated, to: 50, className: "report__band--high" },
  ];
  const ticks = [
    { label: "0%", value: 0 },
    { label: String(low), value: low },
    { label: String(high), value: high },
    { label: String(elevated), value: elevated },
    { label: "50%", value: 50 },
  ];
  return (
    <View className="mt-5" accessibilityLabel={`Body fat ${value}%. Healthy ${low} to ${high}%.`}>
      {/* Band names above the bar. Healthy ends at its right edge and Elevated starts there, so
          the two never overlap even though the Elevated band is narrow */}
      <View className="h-4">
        <Text className="report__tick report__gauge-label" style={{ left: percent(at(low / 2)), width: 80, marginLeft: -40, textAlign: "center" }}>
          Low
        </Text>
        <Text className="report__tick report__gauge-label" style={{ right: percent(1 - at(high)), paddingRight: 3 }}>
          Healthy
        </Text>
        <Text className="report__tick report__gauge-label" style={{ left: percent(at(high)), paddingLeft: 3 }}>
          Elevated
        </Text>
        <Text className="report__tick report__gauge-label" style={{ left: percent(at((elevated + 50) / 2)), width: 80, marginLeft: -40, textAlign: "center" }}>
          High
        </Text>
      </View>
      <View className="mt-1 h-3.5 flex-row overflow-hidden rounded-full">
        {bands.map((band) => (
          <View key={band.label} className={band.className} style={{ width: percent(at(band.to) - at(band.from)) }} />
        ))}
      </View>
      {/* The needle travels from the left end to the value */}
      <Animated.View
        style={{
          position: "absolute",
          bottom: 18,
          height: 22,
          width: 4,
          marginLeft: -2,
          borderRadius: 2,
          backgroundColor: colors.ink,
          left: widthTo(grow, at(value)),
        }}
      />
      <View className="mt-1.5 h-4">
        {ticks.map((tick, index) => (
          <Text
            key={tick.label}
            className="report__tick"
            style={{ position: "absolute", left: percent(at(tick.value)), transform: [{ translateX: index === 0 ? 0 : index === ticks.length - 1 ? -28 : -8 }] }}
          >
            {tick.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

// The body score as a ring that fills, with the number counting up in the middle
export function ScoreRing({ value, size = 64, delay = 0 }: { value: number; size?: number; delay?: number }) {
  return (
    <View accessibilityLabel={`Body score ${value} out of 100`}>
      <ProgressRing progress={value / 100} size={size} delay={delay}>
        {(shown) => <Text className="setup__macro-value">{Math.round(value * shown)}</Text>}
      </ProgressRing>
    </View>
  );
}

export type Part = { label: string; kg: number; color: string };

// What the weight is made of: one bar split into coloured parts that grow in together, then a
// legend row per part with its kg and share
export function StackedBar({ parts, totalKg, delay = 0 }: { parts: Part[]; totalKg: number; delay?: number }) {
  const grow = useGrow(delay);
  if (totalKg <= 0) return null;
  return (
    <View>
      <View className="report__stack">
        {parts.map((part) => (
          <Animated.View key={part.label} style={{ height: "100%", borderRadius: 4, backgroundColor: part.color, width: widthTo(grow, part.kg / totalKg) }} />
        ))}
      </View>
      {parts.map((part, index) => (
        <View key={part.label} className="report__row" style={index === parts.length - 1 ? { borderBottomWidth: 0 } : undefined}>
          <View className="h-3 w-3 rounded" style={{ backgroundColor: part.color }} />
          <Text className="report__label">{part.label}</Text>
          <Text className="report__value">{`${part.kg.toFixed(1)} kg`}</Text>
          <Text className="report__share">{`${Math.round((part.kg / totalKg) * 100)}%`}</Text>
        </View>
      ))}
    </View>
  );
}

// One measure on its own scale: the healthy band shaded, the dot slides to the value
export function ZoneRow({
  label,
  value,
  unit,
  healthy,
  scale,
  pill,
  delay = 0,
}: {
  label: string;
  value: number;
  unit: string;
  healthy: Range;
  scale: readonly [number, number];
  pill: { label: string; tone: Tone };
  delay?: number;
}) {
  const grow = useGrow(delay);
  const [min, max] = scale;
  const bandFrom = barPosition(healthy[0], min, max);
  const bandTo = barPosition(healthy[1], min, max);
  const unitText = unit === "%" ? "%" : ` ${unit}`;
  return (
    <View className="report__zone-row" accessibilityLabel={`${label} ${value}${unitText}, ${pill.label}. Healthy ${healthy[0]} to ${healthy[1]}${unitText}`}>
      <View className="flex-row items-center gap-2">
        <Text className="report__label">{label}</Text>
        <Text className="report__value">
          {value.toFixed(1)}
          <Text className="report__unit">{unitText}</Text>
        </Text>
        <Pill label={pill.label} tone={pill.tone} />
      </View>
      <View className="mt-2.5">
        <View className="report__track">
          <View className="report__zone" style={{ left: percent(bandFrom), width: percent(bandTo - bandFrom) }} />
        </View>
        <Animated.View className="report__dot" style={{ left: widthTo(grow, barPosition(value, min, max)) }} />
      </View>
      <Text className="report__zone-label" style={{ marginLeft: percent(bandFrom) }}>
        {`healthy ${Math.round(healthy[0])}–${Math.round(healthy[1])}${unit === "%" ? "%" : ` ${unit}`}`}
      </Text>
    </View>
  );
}
