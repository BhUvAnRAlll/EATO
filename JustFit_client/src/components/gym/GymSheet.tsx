import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Keyboard, Modal, PanResponder, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn, ReduceMotion, runOnJS, SlideInDown, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
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
  // Sheets this one opens (another GymSheet). They must be rendered inside this Modal: iOS
  // presents a Modal from the nearest view controller, and a sibling Modal would be presented
  // from the screen's controller, which is already presenting this sheet, so it never shows.
  stack?: ReactNode;
};

// The gym portal's bottom sheet (the user's designs): dimmed page, a white sheet rising from the
// bottom with a handle, an optional title, subtitle and close button, and its content scrolling
// above the keyboard. Tapping the dimmed page closes it, and so does dragging the sheet down: from
// the handle always, from the content once it's scrolled to the top.
const CLOSE_DISTANCE = 120;
const CLOSE_VELOCITY = 0.6;

export function GymSheet({ title, subtitle, onClose, children, overlay, onBack, stack }: GymSheetProps) {
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

  // Drag to close: the sheet follows the finger down, then either slides off (far or fast enough)
  // or springs back. From the handle always; from the content only while it's scrolled to the top.
  const atTop = useSharedValue(true);
  const dragY = useSharedValue(0);
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: dragY.get() }] }));
  const responders = useMemo(() => {
    const settle = () => dragY.set(withSpring(0, { damping: 20, stiffness: 220, reduceMotion: ReduceMotion.System }));
    const make = (fromContent: boolean) => {
      const wants = (_: unknown, g: { dx: number; dy: number }) => (!fromContent || atTop.get()) && g.dy > 8 && g.dy > Math.abs(g.dx) * 1.5;
      return PanResponder.create({
        onMoveShouldSetPanResponder: wants,
        onMoveShouldSetPanResponderCapture: wants,
        onPanResponderMove: (_, g) => dragY.set(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (g.dy > CLOSE_DISTANCE || g.vy > CLOSE_VELOCITY) {
            Keyboard.dismiss();
            dragY.set(withTiming(height, { duration: 200, reduceMotion: ReduceMotion.System }, (done) => { if (done) runOnJS(onClose)(); }));
          } else {
            settle();
          }
        },
        onPanResponderTerminate: settle,
      }).panHandlers;
    };
    return { handle: make(false), content: make(true) };
  }, [atTop, dragY, height, onClose]);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(160).reduceMotion(ReduceMotion.System)} style={{ flex: 1, backgroundColor: "rgba(17, 24, 39, 0.45)" }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ marginBottom: keyboard }}>
          <Animated.View entering={SlideInDown.duration(260).reduceMotion(ReduceMotion.System)} className="gym-sheet" style={[{ paddingBottom: bottomPad, maxHeight: sheetMax }, dragStyle]} accessibilityViewIsModal>
            {/* A taller grab area around the handle, so it's easy to catch */}
            <View style={{ paddingVertical: 10, marginTop: -10, marginBottom: -10, alignSelf: "stretch" }} {...responders.handle}>
              <View className="gym-sheet__handle" />
            </View>
            {/* The content scrolls inside the sheet, so the last button is always reachable */}
            <ScrollView style={{ flexShrink: 1, maxHeight: sheetMax - bottomPad - 30 }} contentContainerStyle={{ gap: 16, paddingTop: title ? 0 : 4 }} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"} showsVerticalScrollIndicator={false} bounces={false} scrollEventThrottle={16} onScroll={(e) => atTop.set(e.nativeEvent.contentOffset.y <= 0)} {...responders.content}>
              {title ? (
                <View className="flex-row items-start" style={{ gap: 12 }}>
                  {onBack && (
                    <PressableScale onPress={onBack} hitSlop={10} style={{ paddingTop: 4 }} accessibilityRole="button" accessibilityLabel="Back">
                      <GymIcon name="chevron-left" size={20} color={colors.gymInk} />
                    </PressableScale>
                  )}
                  <View className="flex-1" style={{ gap: 2 }}>
                    <Text className="gym-sheet__title" accessibilityRole="header">{title}</Text>
                    {subtitle ? <Text className="gym-sheet__subtitle">{subtitle}</Text> : null}
                  </View>
                  <PressableScale onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                    <GymIcon name="x" size={22} color={colors.gymInk} />
                  </PressableScale>
                </View>
              ) : null}
              {children}
            </ScrollView>
          </Animated.View>
        </View>
      </Animated.View>
      {overlay}
      {stack}
    </Modal>
  );
}
