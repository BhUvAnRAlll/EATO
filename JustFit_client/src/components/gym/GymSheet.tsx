import { useEffect, useState, type ReactNode } from "react";
import { Keyboard, Modal, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn, ReduceMotion, SlideInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { useThemeColors } from "@/theme";

type GymSheetProps = {
  title?: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  // Drawn over the sheet, inside the same window (a confirm dialog)
  overlay?: ReactNode;
  // Left of the title (a back arrow for a second step)
  onBack?: () => void;
};

// The gym portal's bottom sheet (the user's designs): dimmed page, a white sheet rising from the
// bottom with a handle, an optional title, subtitle and close button, and its content scrolling
// above the keyboard. Tapping the dimmed page closes it.
export function GymSheet({ title, subtitle, onClose, children, overlay, onBack }: GymSheetProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  // The keyboard's height while it's open: the sheet then sits right on it and shrinks to the room
  // left above (so it never slides under the top of the screen or leaves a see-through gap)
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", (e) => setKeyboard(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  // At most 92% of the screen, or the room above the keyboard while it's open
  const sheetMax = keyboard > 0 ? height - keyboard - insets.top - 8 : height * 0.92;
  const bottomPad = keyboard > 0 ? 12 : insets.bottom + 20;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(160).reduceMotion(ReduceMotion.System)} style={{ flex: 1, backgroundColor: "rgba(17, 24, 39, 0.45)" }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ marginBottom: keyboard }}>
          <Animated.View entering={SlideInDown.duration(260).reduceMotion(ReduceMotion.System)} className="gym-sheet" style={{ paddingBottom: bottomPad, maxHeight: sheetMax }} accessibilityViewIsModal>
            <View className="gym-sheet__handle" />
            {/* The content scrolls inside the sheet, so the last button is always reachable */}
            <ScrollView style={{ flexShrink: 1, maxHeight: sheetMax - bottomPad - 30 }} contentContainerStyle={{ gap: 16, paddingTop: title ? 0 : 4 }} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"} showsVerticalScrollIndicator={false} bounces={false}>
              {title ? (
                <View className="flex-row items-start" style={{ gap: 12 }}>
                  {onBack && (
                    <PressableScale onPress={onBack} hitSlop={10} style={{ paddingTop: 4 }} accessibilityRole="button" accessibilityLabel="Back">
                      <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.gymInk} />
                    </PressableScale>
                  )}
                  <View className="flex-1" style={{ gap: 2 }}>
                    <Text className="gym-sheet__title" accessibilityRole="header">{title}</Text>
                    {subtitle ? <Text className="gym-sheet__subtitle">{subtitle}</Text> : null}
                  </View>
                  <PressableScale onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                    <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={22} tintColor={colors.gymInk} />
                  </PressableScale>
                </View>
              ) : null}
              {children}
            </ScrollView>
          </Animated.View>
        </View>
      </Animated.View>
      {overlay}
    </Modal>
  );
}
