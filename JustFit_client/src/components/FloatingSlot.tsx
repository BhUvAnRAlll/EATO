// A floating button that steps aside while a list scrolls down (shared by the gym portal and the
// member app's Macro tab, 2026-11-08)
import { useCallback, useRef, useState, type ReactNode } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, withTiming } from "react-native-reanimated";

// Room under a list's last item for the round + (56 tall, 16 from the edge, 16 to spare, plus
// a little air), so the last card's bell or amount scrolls clear of it
export const FAB_CLEARANCE = 104;

// The round + steps aside while the list scrolls down (it covered the Today tiles, the Needs
// attention counts and the last card's bell, 2026-11-08 review) and comes back on the way up,
// at the top and at the end of the list (where FAB_CLEARANCE keeps the last item clear of it).
export function useFabOnScroll() {
  const [hidden, setHidden] = useState(false);
  const last = useRef(0);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    const y = contentOffset.y;
    const atEnd = y + layoutMeasurement.height >= contentSize.height - 24;
    const dy = y - last.current;
    if (Math.abs(dy) < 8 && !atEnd && y > 0) return;
    last.current = y;
    setHidden(!(y <= 0 || atEnd || dy < 0));
  }, []);

  return { onScroll, scrollEventThrottle: 32, hidden };
}

// The + at the bottom right over the content, fading and sliding away while `hidden`
export function FloatingSlot({ hidden, bottom = 16, right = 16, children }: { hidden: boolean; bottom?: number; right?: number; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const style = useAnimatedStyle(() => {
    const duration = reduceMotion ? 0 : 180;
    return {
      opacity: withTiming(hidden ? 0 : 1, { duration }),
      transform: [{ translateY: withTiming(hidden ? 24 : 0, { duration }) }],
    };
  });
  return (
    <Animated.View style={[{ position: "absolute", right, bottom }, style]} pointerEvents={hidden ? "none" : "box-none"}>
      {children}
    </Animated.View>
  );
}
