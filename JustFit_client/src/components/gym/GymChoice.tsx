import { Text, View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { GradientFill } from "@/components/gym/GradientFill";
import { haptic } from "@/lib/haptics";
import { useThemeColors } from "@/theme";

// One-of chips in a row with their label, as in the designs (Gender, Mode). `clearable`: tap the
// chosen one again to clear it.
export function ChipRow<T extends string>({ label, options, value, onChange, clearable = false }: { label: string; options: Record<T, string>; value: T | ""; onChange: (value: T | "") => void; clearable?: boolean }) {
  return (
    <View className="flex-row flex-wrap items-center" style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text className="gym-field__label" style={{ fontSize: 14, marginRight: 4 }}>{label}</Text>
      {(Object.keys(options) as T[]).map((id) => {
        const selected = id === value;
        return (
          <PressableScale key={id} onPress={() => { haptic.select(); onChange(selected && clearable ? "" : id); }} className={selected ? "gym-kind gym-kind--selected" : "gym-kind"} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={options[id]}>
            {selected && <GradientFill radius={999} />}
            <Text className={selected ? "gym-kind__label gym-kind__label--selected" : "gym-kind__label"}>{options[id]}</Text>
          </PressableScale>
        );
      })}
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
        {checked && <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={13} tintColor={colors.white} />}
      </View>
      <Text className="gym-field__label" style={{ fontSize: 14 }}>{label}</Text>
    </PressableScale>
  );
}

export const METHODS = { online: "ONLINE", cash: "CASH" } as const;
