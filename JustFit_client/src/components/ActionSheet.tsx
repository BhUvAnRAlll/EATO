import { Modal, Pressable, Text, View } from "react-native";

import { useActionSheetStore, type SheetAction } from "@/store/actionSheet";
import { useThemeColors } from "@/theme";

type ActionSheetProps = { visible: boolean; title?: string; message?: string; actions: SheetAction[]; onClose: () => void };

// A bottom sheet of actions, the Android and web side of lib/nativeSheets.ts showActions (iPhone
// shows UIKit's own). Same look as the setup sheets.
export function ActionSheet({ visible, title, message, actions, onClose }: ActionSheetProps) {
  const colors = useThemeColors();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* The backdrop is a sibling of the sheet, not its parent: a Pressable inside a Pressable
          renders nested <button>s on the web */}
      <View className="verify__backdrop">
        <Pressable className="flex-1" onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View className="verify__sheet gap-2" accessibilityViewIsModal>
          {title && <Text className="setup__section mb-1 text-center">{title}</Text>}
          {message && <Text className="card__subtitle mb-1 text-center">{message}</Text>}
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

// Mounted once at the app's root: draws whatever showActions opened
export function ActionSheetHost() {
  const sheet = useActionSheetStore((state) => state.sheet);
  const close = useActionSheetStore((state) => state.close);
  return <ActionSheet visible={sheet !== null} title={sheet?.title} message={sheet?.message} actions={sheet?.actions ?? []} onClose={close} />;
}
