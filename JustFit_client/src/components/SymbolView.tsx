import { SymbolView as ExpoSymbolView, type SymbolViewProps } from "expo-symbols";
import { Check, Circle, Play, RectangleHorizontal, Settings, Shield, Square, Triangle, type LucideIcon } from "lucide-react-native";
import { Platform, View, type ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";

import { iconTint } from "@/constants/iconColors";
import { lucideSymbols } from "@/constants/lucideSymbols";
import { materialSymbols } from "@/constants/symbols";
import { Bounce, useBounceCount } from "@/components/motion/Bounce";

// SF Symbol ".fill" names drawn solid on Android and the web: simple shapes, where filling
// doesn't hide a mark inside
const SOLID = new Set([
  "bag.fill", "bell.fill", "bolt.fill", "bubble.left.fill", "bubble.right.fill", "bubble.left.and.bubble.right.fill", "camera.fill",
  "carrot.fill", "drop.fill", "dumbbell.fill", "flame.fill", "heart.fill", "house.fill", "leaf.fill", "lightbulb.fill",
  "lock.fill", "mic.fill", "moon.fill", "pause.fill", "person.fill", "person.2.fill", "play.fill", "scalemass.fill",
  "square.grid.2x2.fill", "star.fill", "sun.max.fill", "sunrise.fill",
]);

// Solid shapes with a mark knocked out of them in white, like the SF Symbols (a check in a filled
// circle, a ! in a filled triangle): the shape, the mark ("!" is drawn), and the mark's size
type Knockout = { shape: LucideIcon; mark: LucideIcon | "!"; scale: number; dy?: number };
const KNOCKOUT: Record<string, Knockout> = {
  "checkmark.circle.fill": { shape: Circle, mark: Check, scale: 0.5 },
  "exclamationmark.circle.fill": { shape: Circle, mark: "!", scale: 0.5 },
  "play.circle.fill": { shape: Circle, mark: Play, scale: 0.42 },
  "checkmark.square.fill": { shape: Square, mark: Check, scale: 0.5 },
  "checkmark.seal.fill": { shape: Circle, mark: Check, scale: 0.5 },
  "exclamationmark.shield.fill": { shape: Shield, mark: "!", scale: 0.45 },
  "exclamationmark.triangle.fill": { shape: Triangle, mark: "!", scale: 0.42, dy: 0.06 },
  "play.rectangle.fill": { shape: RectangleHorizontal, mark: Play, scale: 0.38 },
};

// Lucide draws a few shapes at an angle where the SF Symbol is level: turned to match the iPhone
const TURN: Record<string, string> = { dumbbell: "45deg", "dumbbell.fill": "45deg" };

// Apple's "sparkles" shape (the AI Coach button): one large four-point star with sharp, inward
// curving sides and two small ones above it. Lucide's is rounder with a plus, so it is drawn here.
const star = (cx: number, cy: number, r: number) => `M${cx} ${cy - r}C${cx + r * 0.12} ${cy - r * 0.12} ${cx + r * 0.12} ${cy - r * 0.12} ${cx + r} ${cy}C${cx + r * 0.12} ${cy + r * 0.12} ${cx + r * 0.12} ${cy + r * 0.12} ${cx} ${cy + r}C${cx - r * 0.12} ${cy + r * 0.12} ${cx - r * 0.12} ${cy + r * 0.12} ${cx - r} ${cy}C${cx - r * 0.12} ${cy - r * 0.12} ${cx - r * 0.12} ${cy - r * 0.12} ${cx} ${cy - r}Z`;
function Sparkles({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={star(10, 14, 8.5)} fill={color} />
      <Path d={star(18.5, 5.5, 3.6)} fill={color} />
      <Path d={star(19.5, 13.5, 2.2)} fill={color} />
    </Svg>
  );
}

// A drawn "!" (Lucide has none on its own), as tall as `size`
function Bang({ size, color }: { size: number; color: string }) {
  const w = Math.max(2, size * 0.16);
  return (
    <View style={{ alignItems: "center", height: size, justifyContent: "space-between" }}>
      <View style={{ width: w, height: size * 0.68, borderRadius: w, backgroundColor: color }} />
      <View style={{ width: w, height: w, borderRadius: w, backgroundColor: color }} />
    </View>
  );
}

// Screens write an SF Symbol name (name="envelope", or { ios, android, web }). iOS draws the SF
// Symbol natively. Android and the web draw the nearest Lucide icon (constants/lucideSymbols.ts),
// so every phone shows the same thin, rounded iPhone-style icons (the owner's choice, 2026-11-08):
// filled SF Symbols are drawn solid or as a solid shape with a white mark, and the exercise
// figures, which Lucide doesn't have, use Google's solid pictograms (closest to Apple's). Other
// names without a Lucide twin fall back to the Material Symbols font.
function SymbolGlyph({ name, size = 24, tintColor, style, ...props }: SymbolViewProps) {
  const sf = typeof name === "string" ? name : name.ios;
  if (Platform.OS !== "ios" && sf && !sf.startsWith("figure.")) {
    const color = (tintColor ?? "#111111") as string;
    const box = [{ width: size, height: size, alignItems: "center" as const, justifyContent: "center" as const }, style];
    const knock = KNOCKOUT[sf];
    if (knock) {
      const Shape = knock.shape;
      const Mark = knock.mark;
      return (
        <View style={box} pointerEvents="none">
          <Shape size={size * 0.9} color={color} fill={color} strokeWidth={1.9} />
          <View style={{ position: "absolute", transform: [{ translateY: (knock.dy ?? 0) * size }] }}>
            {Mark === "!" ? <Bang size={size * knock.scale} color="#FFFFFF" /> : <Mark size={size * knock.scale} color="#FFFFFF" fill={Mark === Play ? "#FFFFFF" : "none"} strokeWidth={2.6} />}
          </View>
        </View>
      );
    }
    if (sf === "sparkles") {
      return <View style={box} pointerEvents="none"><Sparkles size={size * 1.15} color={color} /></View>;
    }
    if (sf === "gearshape.fill") {
      return (
        <View style={box} pointerEvents="none">
          <Settings size={size * 0.9} color={color} fill={color} strokeWidth={1.9} />
          <View style={{ position: "absolute", width: size * 0.26, height: size * 0.26, borderRadius: size, backgroundColor: "#FFFFFF" }} />
        </View>
      );
    }
    if (sf === "exclamationmark") {
      return <View style={box} pointerEvents="none"><Bang size={size * 0.8} color={color} /></View>;
    }
    const Icon = lucideSymbols[sf];
    if (Icon) {
      return (
        <View style={box} pointerEvents="none">
          <View style={TURN[sf] ? { transform: [{ rotate: TURN[sf] }] } : undefined}>
            <Icon size={size * 0.9} color={color} fill={SOLID.has(sf) ? color : "none"} strokeWidth={1.9} />
          </View>
        </View>
      );
    }
  }
  if (typeof name !== "string") {
    const material = sf ? materialSymbols[sf] : undefined;
    return <ExpoSymbolView name={material ? { ios: name.ios, android: material, web: material } : name} size={size} tintColor={tintColor as ColorValue} style={style} {...props} />;
  }

  const material = materialSymbols[name];
  if (__DEV__ && !material) console.warn(`No Material Symbols name for "${name}" in constants/symbols.ts`);
  return <ExpoSymbolView name={{ ios: name, android: material, web: material }} size={size} tintColor={tintColor} style={style} {...props} />;
}

// Symbol effects (2026-11-09): `bounce` (any value) plays a bounce each time it changes, and
// `bounceOnMount` once when the icon appears (a success tick). iPhone plays the SF Symbol's own
// effect (the view is remade so the effect runs again); Android and the web scale the drawn icon
// (components/motion/Bounce.tsx). Nothing with Reduce Motion on.
// `meaningColor` (on by default): an icon drawn in the brand green takes its meaning's colour
// (constants/iconColors.ts); the tab bar turns it off, its green meaning "selected".
type BounceProps = { bounce?: unknown; bounceOnMount?: boolean; meaningColor?: boolean };
export function SymbolView({ bounce, bounceOnMount = false, meaningColor = true, ...given }: SymbolViewProps & BounceProps) {
  const sf = typeof given.name === "string" ? given.name : given.name.ios;
  const props = meaningColor ? { ...given, tintColor: iconTint(sf, given.tintColor) as SymbolViewProps["tintColor"] } : given;
  const count = useBounceCount(bounce, bounceOnMount);
  if (bounce === undefined && !bounceOnMount) return <SymbolGlyph {...props} />;
  if (Platform.OS === "ios") {
    return <SymbolGlyph key={count} {...props} animationSpec={count > 0 ? { effect: { type: "bounce", wholeSymbol: true, direction: "up" } } : undefined} />;
  }
  return <Bounce count={count}><SymbolGlyph {...props} /></Bounce>;
}

export type { SymbolViewProps };
