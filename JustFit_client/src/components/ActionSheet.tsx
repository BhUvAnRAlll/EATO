import { Modal, Pressable, Text } from "react-native";

import { useThemeColors } from "@/theme";

export type SheetAction = { label: string; destructive?: boolean; onPress: () => void };

type ActionSheetProps = { visible: boolean; title?: string; actions: SheetAction[]; onClose: () => void };

// A bottom sheet of actions (a workout day's options). Same look as the setup sheets.
export function ActionSheet({ visible, title, actions, onClose }: ActionSheetProps) {
  const colors = useThemeColors();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="verify__backdrop" onPress={onClose} accessibilityLabel="Close">
        <Pressable className="verify__sheet gap-2" onPress={() => {}} accessibilityViewIsModal accessible={false}>
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
        </Pressable>
      </Pressable>
    </Modal>
  );
}
