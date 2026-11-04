import { gymIcons, type GymIconName } from "@/constants/gymIcons";

// Every icon in the gym portal: one line weight at every size (the stroke stays 1.75 px, it
// doesn't thin out on big icons or thicken on small ones). Icons are decoration: the button or
// row around them carries the accessibility label.
export function GymIcon({ name, size = 20, color }: { name: GymIconName; size?: number; color: string }) {
  const Glyph = gymIcons[name];
  return <Glyph size={size} color={color} strokeWidth={1.75} absoluteStrokeWidth accessible={false} importantForAccessibility="no" />;
}
