import { useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { colors } from "@/theme";

type ProgressRingProps = {
  // 0–1 of the ring to fill (clamped)
  progress: number;
  size?: number;
  stroke?: number;
  color?: string;
  // Unfilled part of the ring; soft grey unless the ring sits on a dark card
  trackColor?: string;
  // Starts filling after this many ms
  delay?: number;
  // What sits in the middle; receives how far the fill animation has got (0–1), so a number
  // can count up with it
  children?: (animated: number) => ReactNode;
};

// A red ring that fills once when it appears (at once with Reduce Motion on). Used for
// Home's progress card and the scan report's body score.
export function ProgressRing({ progress, size = 64, stroke = 7, color = colors.leaf, trackColor = colors.creamTab, delay = 0, children }: ProgressRingProps) {
  const [grow] = useState(() => new Animated.Value(0));
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = grow.addListener(({ value }) => setShown(value));
    let animation: Animated.CompositeAnimation | null = null;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (reduce) return grow.setValue(1);
        animation = Animated.timing(grow, { toValue: 1, duration: 800, delay, useNativeDriver: false });
        animation.start();
      });
    return () => {
      animation?.stop();
      grow.removeListener(id);
    };
  }, [grow, delay]);

  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * Math.min(1, Math.max(0, progress)) * shown;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={trackColor} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View className="absolute inset-0 items-center justify-center">{children?.(shown)}</View>
    </View>
  );
}
