import { useEffect, useState, type ReactNode } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";

import { useThemeColors } from "@/theme";

type BottomSheetProps = {
  onClose: () => void;
  // While true, the backdrop and Android back don't close it (e.g. during a delete)
  locked?: boolean;
  // Gets `dismiss`, which slides the sheet down and then calls onClose
  children: (dismiss: () => void) => ReactNode;
};

// A sheet that slides up from the bottom over a fading backdrop, with a grab handle, and slides
// back down to close. Mount it to open; it calls onClose once it is down.
export function BottomSheet({ onClose, locked = false, children }: BottomSheetProps) {
  const colors = useThemeColors();
  const { height } = useWindowDimensions();
  // 1 = off screen below, 0 = fully up
  const [slide] = useState(() => new Animated.Value(1));
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    Animated.timing(slide, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [slide]);

  const dismiss = () => {
    if (closing) return;
    setClosing(true);
    Animated.timing(slide, { toValue: 1, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => onClose());
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={locked ? undefined : dismiss}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: slide.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>
          <Pressable className="verify__backdrop" onPress={locked ? undefined : dismiss} accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View className="verify__sheet" style={{ maxHeight: "86%", paddingTop: 12, transform: [{ translateY: Animated.multiply(slide, height) }] }} accessibilityViewIsModal>
          <View className="mb-4 self-center rounded-pill" style={{ width: 40, height: 5, backgroundColor: colors.lineStrong }} />
          {children(dismiss)}
        </Animated.View>
      </View>
    </Modal>
  );
}
