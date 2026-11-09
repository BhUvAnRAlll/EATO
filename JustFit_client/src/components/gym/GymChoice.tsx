import { Text, View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { GradientFill } from "@/components/gym/GradientFill";
import { ChoiceChip } from "@/components/gym/GymChip";
import { haptic } from "@/lib/haptics";
import { useThemeColors } from "@/theme";

// One-of chips under their label, as in the designs (Gender, Mode). The label sits above the
// chips, full width, so chips that wrap line up under each other. `clearable`: tap the chosen one
// again to clear it.
export function ChipRow<T extends string>({ label, options, value, onChange, clearable = false }: { label: string; options: Record<T, string>; value: T | ""; onChange: (value: T | "") => void; clearable?: boolean }) {
  return (
    <View style={{ gap: 8 }}>
      <Text className="gym-field__label" style={{ fontSize: 14 }}>{label}</Text>
      <View className="flex-row flex-wrap items-center" style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {(Object.keys(options) as T[]).map((id) => {
          const selected = id === value;
          return (
            <ChoiceChip key={id} onPress={() => { haptic.select(); onChange(selected && clearable ? "" : id); }} selected={selected} label={options[id]} accessibilityRole="radio" accessibilityState={{ selected }} />
          );
        })}
      </View>
    </View>
  );
}

// A tick box with its label (Send Invoice)
export function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const colors = useThemeColors();
  return (
    <PressableScale onPress={() => { haptic.select(); onChange(!checked); }} className="flex-row items-center self-start" style={{ gap: 10, minHeight: 40 }} accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label}>
      <View className={checked ? "gym-check gym-check--on" : "gym-check"}>
        {checked && <GradientFill radius={5} />}
        {checked && <GymIcon name="check" size={13} color={colors.white} />}
      </View>
      <Text className="gym-field__label" style={{ fontSize: 14 }}>{label}</Text>
    </PressableScale>
  );
}

export const METHODS = { online: "Online", cash: "Cash" } as const;
