import { Modal, Pressable, Text, View } from "react-native";

import { useThemeColors } from "@/theme";

export type SheetAction = { label: string; destructive?: boolean; onPress: () => void };

type ActionSheetProps = { visible: boolean; title?: string; actions: SheetAction[]; onClose: () => void };

// A bottom sheet of actions (a workout day's options). Same look as the setup sheets.
export function ActionSheet({ visible, title, actions, onClose }: ActionSheetProps) {
  const colors = useThemeColors();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* The backdrop is a sibling of the sheet, not its parent: a Pressable inside a Pressable
          renders nested <button>s on the web */}
      <View className="verify__backdrop">
        <Pressable className="flex-1" onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View className="verify__sheet gap-2" accessibilityViewIsModal>
          {title && <Text className="setup__section mb-1 text-center">{title}</Text>}
          {actions.map((action) => (
            <Pressable
              key={action.label}
              onPress={() => {
                onClose();
                action.onPress();
              }}
              className="btn-outline"
              accessibilityRole="button"
            >
              <Text className="btn-outline__label" style={action.destructive ? { color: colors.danger } : undefined}>
                {action.label}
              </Text>
            </Pressable>
          ))}
          <Pressable onPress={onClose} className="btn-forest mt-1" accessibilityRole="button">
            <Text className="btn-forest__label">Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
