import { useEffect } from "react";
import { View, type DimensionValue } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

// Loading placeholders: grey blocks in the shape of what's coming, breathing softly, instead
// of a spinner. Everything inside one <SkeletonPulse> breathes together (one animation per
// group, on the UI thread). Screen readers hear a single "Loading" for the group.

type PulseProps = { children: React.ReactNode; label?: string; className?: string };

export function SkeletonPulse({ children, label = "Loading", className }: PulseProps) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) return;
    opacity.set(withRepeat(withTiming(0.45, { duration: 750, easing: Easing.inOut(Easing.ease) }), -1, true));
  }, [opacity, reduceMotion]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <Animated.View className={className} style={style} accessible accessibilityRole="progressbar" accessibilityLabel={label}>
      {children}
    </Animated.View>
  );
}

type BlockProps = { width?: DimensionValue; height?: number; round?: boolean; className?: string };

// One grey block (a line of text, an avatar, a bar)
export function SkeletonBlock({ width = "100%", height = 14, round = false, className }: BlockProps) {
  return <View className={className ? `skeleton ${className}` : "skeleton"} style={{ width, height, borderRadius: round ? 999 : undefined }} />;
}

// A card-shaped placeholder: an icon and title row, then a few lines
export function SkeletonCard({ lines = 2, tall = false }: { lines?: number; tall?: boolean }) {
  return (
    <View className="skeleton-card">
      <View className="flex-row items-center gap-3">
        <SkeletonBlock width={40} height={40} round />
        <View className="flex-1 gap-2">
          <SkeletonBlock width="55%" height={14} />
          <SkeletonBlock width="35%" height={12} />
        </View>
      </View>
      {tall && <SkeletonBlock height={96} className="mt-4" />}
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonBlock key={i} width={i === lines - 1 ? "70%" : "100%"} height={12} className={i === 0 ? "mt-4" : "mt-2"} />
      ))}
    </View>
  );
}

// What a screen shows while its first read is on the way: a few cards, breathing together
export function ScreenSkeleton({ cards = 3, label = "Loading", hero = false }: { cards?: number; label?: string; hero?: boolean }) {
  return (
    <SkeletonPulse label={label} className="gap-4">
      {hero && <View className="skeleton-card"><SkeletonBlock width="40%" height={14} /><SkeletonBlock height={120} className="mt-4" /></View>}
      {Array.from({ length: cards }, (_, i) => <SkeletonCard key={i} lines={i === 0 ? 3 : 2} />)}
    </SkeletonPulse>
  );
}
