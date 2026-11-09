import { Text, View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { useThemeColors } from "@/theme";

type QuantityStepperProps = {
  quantity: number;
  max: number;
  name: string;
  onChange: (quantity: number) => void;
  size?: "sm" | "md";
};

// − 2 + for a meal in the cart. At 1, minus takes it out of the cart; plus stops at `max`.
export function QuantityStepper({ quantity, max, name, onChange, size = "md" }: QuantityStepperProps) {
  const colors = useThemeColors();
  const box = size === "sm" ? 32 : 40;
  const full = quantity >= max;
  return (
    <View className="meal-stepper" accessibilityLabel={`${quantity} ${name} in cart`}>
      <PressableScale
        haptic="select"
        onPress={() => onChange(quantity - 1)}
        className="meal-stepper__button"
        style={{ width: box, height: box }}
        accessibilityRole="button"
        accessibilityLabel={quantity === 1 ? `Remove ${name} from cart` : `One less ${name}`}
      >
        <SymbolView name={quantity === 1 ? { ios: "trash", android: "delete", web: "delete" } : { ios: "minus", android: "remove", web: "remove" }} size={size === "sm" ? 14 : 16} tintColor={colors.onPrimary} />
      </PressableScale>
      <Text className="meal-stepper__count" style={{ minWidth: size === "sm" ? 22 : 28 }}>{quantity}</Text>
      <PressableScale
        haptic="select"
        onPress={() => !full && onChange(quantity + 1)}
        disabled={full}
        className="meal-stepper__button"
        style={{ width: box, height: box, opacity: full ? 0.4 : 1 }}
        accessibilityRole="button"
        accessibilityLabel={full ? `At most ${max} of ${name}` : `One more ${name}`}
        accessibilityState={{ disabled: full }}
      >
        <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={size === "sm" ? 14 : 16} tintColor={colors.onPrimary} />
      </PressableScale>
    </View>
  );
}
