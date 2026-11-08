import { useEffect, useRef, useState, type ReactNode } from "react";
import { Keyboard, Modal, Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import { GestureDetector, GestureHandlerRootView, ScrollView, usePanGesture } from "react-native-gesture-handler";
import Animated, { FadeIn, ReduceMotion, SlideInDown, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HudHost } from "@/components/Hud";
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
  // Closes the overlay (a confirm dialog) instead of the sheet: Android's back button and the
  // backdrop then take one step back, not the whole form away (QA 2026-11-07)
  onDismissOverlay?: () => void;
};

// The gym portal's bottom sheet (the user's designs): dimmed page, a white sheet rising from the
// bottom with a handle, an optional title, subtitle and close button, and its content scrolling
// above the keyboard. Tapping the dimmed page closes it, and so does dragging the sheet down: from
// the handle always, from the content once it's scrolled to the top.
const CLOSE_DISTANCE = 120;
const CLOSE_VELOCITY = 600; // points a second
const HANDLE_HEIGHT = 30;

export function GymSheet({ title, subtitle, onClose, children, overlay, onBack, stack, onDismissOverlay }: GymSheetProps) {
  // With an overlay up, a step back closes the overlay; without one, the sheet
  const requestClose = overlay && onDismissOverlay ? onDismissOverlay : onClose;
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  // The keyboard's height while it's open: the sheet then sits right on it and shrinks to the room
  // left above (so it never slides under the top of the screen or leaves a see-through gap)
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    // A sheet opens with no field focused, so a keyboard still up belongs to whatever is under it
    // (another sheet's field) and would cover this one: put it away (2026-11-07, the user's
    // screenshots: dialogs and second sheets opened over the keyboard on every screen)
    Keyboard.dismiss();
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
  // or springs back. The pan is a gesture-handler one, declared simultaneous with the content's
  // own scroll (the library's ScrollView): a plain PanResponder never got the touch on iOS, where
  // the native scroll claimed it first, so a tall sheet like a member's options could only be
  // closed from its thin handle. A drag counts from the handle always, from the content only when
  // it started scrolled to the top (otherwise it just scrolls).
  const scrollY = useRef(0);
  const closing = useRef(false);
  const fromTop = useRef(true);
  const dragY = useSharedValue(0);
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: dragY.get() }] }));
  const settle = () => dragY.set(withSpring(0, { damping: 20, stiffness: 220, reduceMotion: ReduceMotion.System }));
  const pan = usePanGesture({
    runOnJS: true,
    activeOffsetY: 8,
    failOffsetX: [-16, 16],
    // Where the finger landed on the sheet: the top HANDLE_HEIGHT points are the handle
    onBegin: (e) => { fromTop.current = e.y <= HANDLE_HEIGHT || scrollY.current <= 0; },
    onUpdate: (e) => { if (fromTop.current && !closing.current) dragY.set(Math.max(0, e.translationY)); },
    onDeactivate: (e) => {
      if (closing.current || !fromTop.current) return;
      if (e.translationY > CLOSE_DISTANCE || e.velocityY > CLOSE_VELOCITY) {
        closing.current = true;
        Keyboard.dismiss();
        dragY.set(withTiming(height, { duration: 200, reduceMotion: ReduceMotion.System }));
        setTimeout(onClose, 200);
      } else {
        settle();
      }
    },
  });

  return (
    <Modal visible transparent animationType="none" onRequestClose={requestClose} statusBarTranslucent>
      {/* A Modal is its own native window: gestures inside it need their own root view */}
      <GestureHandlerRootView style={{ flex: 1 }}>
      <Animated.View entering={FadeIn.duration(160).reduceMotion(ReduceMotion.System)} style={{ flex: 1, backgroundColor: "rgba(17, 24, 39, 0.45)" }}>
        <Pressable style={{ flex: 1 }} onPress={requestClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ marginBottom: keyboard }}>
          <GestureDetector gesture={pan}>
          <Animated.View entering={SlideInDown.duration(260).reduceMotion(ReduceMotion.System)} className="gym-sheet" style={[{ paddingBottom: bottomPad, maxHeight: sheetMax }, dragStyle]} accessibilityViewIsModal>
            {/* A taller grab area around the handle, so it's easy to catch */}
            <View style={{ paddingVertical: 10, marginTop: -10, marginBottom: -10, alignSelf: "stretch" }}>
              <View className="gym-sheet__handle" />
            </View>
            {/* The content scrolls inside the sheet, so the last button is always reachable; its
                scroll runs alongside the drag, which only follows a pull from the top */}
            <ScrollView simultaneousWith={pan} style={{ flexShrink: 1, maxHeight: sheetMax - bottomPad - 30 }} contentContainerStyle={{ gap: 16, paddingTop: title ? 0 : 4 }} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"} showsVerticalScrollIndicator={false} bounces={false} overScrollMode="never" scrollEventThrottle={16} onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }}>
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
          </GestureDetector>
        </View>
      </Animated.View>
      {overlay}
      <HudHost />
      {stack}
      </GestureHandlerRootView>
    </Modal>
  );
}
