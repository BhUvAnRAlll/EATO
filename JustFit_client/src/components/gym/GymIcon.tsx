import { Platform, View } from "react-native";

import { Bounce, useBounceCount } from "@/components/motion/Bounce";
import { gymIcons, type GymIconName } from "@/constants/gymIcons";

// Every icon in the gym portal: one line weight at every size (the stroke stays 1.75 px, it
// doesn't thin out on big icons or thicken on small ones). Icons are decoration: the button or
// row around them carries the accessibility label.
//
// On the web the icon sits in a View: a bare <svg> isn't positioned, so a GradientFill (absolute)
// behind it in a filled control would paint over it. The web <svg> also gets aria-hidden, never
// the native-only accessibility props (React refuses them on a DOM element).
//
// Symbol effects (2026-11-09): `bounce` (any value) gives the icon a short scale each time it
// changes, `bounceOnMount` once when it appears (components/motion/Bounce.tsx). `fill` paints the
// shape solid (a review's filled stars, 2026-11-09)
export function GymIcon({ name, size = 20, color, fill = "none", bounce, bounceOnMount = false }: { name: GymIconName; size?: number; color: string; fill?: string; bounce?: unknown; bounceOnMount?: boolean }) {
  const count = useBounceCount(bounce, bounceOnMount);
  const glyph = <GymGlyph name={name} size={size} color={color} fill={fill} />;
  return bounce === undefined && !bounceOnMount ? glyph : <Bounce count={count}>{glyph}</Bounce>;
}

function GymGlyph({ name, size, color, fill }: { name: GymIconName; size: number; color: string; fill: string }) {
  const Glyph = gymIcons[name];
  if (Platform.OS === "web") {
    return (
      <View pointerEvents="none" style={{ width: size, height: size }}>
        <Glyph size={size} color={color} fill={fill} strokeWidth={1.75} absoluteStrokeWidth aria-hidden />
      </View>
    );
  }
  return <Glyph size={size} color={color} fill={fill} strokeWidth={1.75} absoluteStrokeWidth accessible={false} importantForAccessibility="no" />;
}
