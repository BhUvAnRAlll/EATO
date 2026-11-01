import { Modal, Pressable, Text, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";

import type { Option } from "@/types/profile";
import { useThemeColors } from "@/theme";

type SelectSheetProps<T extends string> = {
  visible: boolean;
  title: string;
  options: Option<T>[];
  selected: T | null;
  onSelect: (id: T) => void;
  onClose: () => void;
};

// Bottom sheet with a list of options; picking one closes it
export function SelectSheet<T extends string>({ visible, title, options, selected, onSelect, onClose }: SelectSheetProps<T>) {
  const colors = useThemeColors();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="verify__backdrop">
        <Pressable className="flex-1" onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View className="verify__sheet">
          <Text className="setup__title">{title}</Text>
          <View className="mt-4 gap-2">
            {options.map((option) => {
              const isSelected = option.id === selected;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => {
                    onSelect(option.id);
                    onClose();
                  }}
                  className={isSelected ? "setup__card setup__card--selected flex-row items-center" : "setup__card flex-row items-center"}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected }}
                >
                  <View className="flex-1">
                    <Text className="setup__card-title">{option.label}</Text>
                    {option.description && <Text className="setup__card-text mt-0.5">{option.description}</Text>}
                  </View>
                  {isSelected && (
                    <SymbolView
                      name={{ ios: "checkmark", android: "check", web: "check" }}
                      size={18}
                      tintColor={colors.leaf}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}
