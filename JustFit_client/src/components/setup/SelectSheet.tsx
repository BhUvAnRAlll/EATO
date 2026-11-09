import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="verify__backdrop">
        <Pressable className="flex-1" onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        {/* The sheet's own padding plus the home indicator, so the last option never sits on it */}
        {/* Capped like BottomSheet so a long list scrolls instead of running off the screen */}
        <View className="verify__sheet" style={{ maxHeight: "86%", paddingBottom: 32 + insets.bottom }}>
          <Text className="setup__title">{title}</Text>
          <ScrollView className="mt-4" contentContainerStyle={styles.options} showsVerticalScrollIndicator={false}>
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
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  options: { gap: 8 },
});
