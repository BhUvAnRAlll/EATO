import { View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView, type SymbolViewProps } from "@/components/SymbolView";
import { Palette, useThemeColors } from "@/theme";

type Variant = "outline" | "primary" | "soft" | "dark";

type IconButtonProps = {
  icon: SymbolViewProps["name"];
  // Accessible name (the button has no visible text)
  label: string;
  // Without onPress it is drawn as a plain circle, for use inside a card that is the button
  onPress?: () => void;
  variant?: Variant;
  size?: number;
  disabled?: boolean;
  // The soft red glow under the main play button (one per screen)
  glow?: boolean;
};

// Written out in full so Tailwind finds every class when it builds the styles
const variantClass: Record<Variant, string> = {
  outline: "icon-btn icon-btn--outline",
  primary: "icon-btn icon-btn--primary",
  soft: "icon-btn icon-btn--soft",
  dark: "icon-btn icon-btn--dark",
};

const tint = (colors: Palette): Record<Variant, string> => ({
  outline: colors.forestInk,
  primary: colors.onPrimary,
  soft: colors.leaf,
  dark: colors.onInverse,
});

// Peak Fitness IconButton: outline for app bars, primary (red) for row arrows and play,
// soft for inactive play buttons, dark on the dark hero cards
export function IconButton({ icon, label, onPress, variant = "outline", size = 44, disabled = false, glow = false }: IconButtonProps) {
  const colors = useThemeColors();
  const className = glow ? `${variantClass[variant]} icon-btn--glow` : variantClass[variant];
  const style = { width: size, height: size, opacity: disabled ? 0.4 : 1 };
  const glyph = <SymbolView name={icon} size={Math.round(size * 0.45)} tintColor={tint(colors)[variant]} />;

  if (!onPress) {
    return (
      <View className={className} style={style} accessibilityElementsHidden importantForAccessibility="no">
        {glyph}
      </View>
    );
  }
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      scaleTo={0.92}
      haptic={variant === "primary" ? "tap" : undefined}
      hitSlop={6}
      className={className}
      style={style}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      {glyph}
    </PressableScale>
  );
}
