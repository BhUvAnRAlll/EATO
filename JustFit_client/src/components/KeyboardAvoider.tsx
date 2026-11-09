import { useEffect, useState, type ReactNode } from "react";
import { Keyboard, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Keeps a form's fields and its Save above the keyboard on both phones. Android draws the app
// edge to edge, so the window no longer shrinks for the keyboard and the view must add the
// padding itself, as on iOS; and the keyboard height Android reports leaves out the navigation
// bar under it, so that bar's height is added back (found on a OnePlus, 2026-11-08: a field at
// the bottom of a form stayed half under the keyboard).
//
// It pads by the keyboard's height itself rather than using KeyboardAvoidingView: the app is laid
// out at a design width and shrunk on narrow phones (lib/reactNative.js), and the app's Keyboard
// reports heights in those layout points, while KeyboardAvoidingView compares its own frame with
// the keyboard's real screen position and gets the padding wrong once the app is scaled.
// fill: false inside something sized by its content (a bottom sheet), where flex: 1 would collapse it
export function KeyboardAvoider({ children, fill = true }: { children: ReactNode; fill?: boolean }) {
  const insets = useSafeAreaInsets();
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", (e) => setKeyboard(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const padding = keyboard > 0 ? keyboard + (Platform.OS === "android" ? insets.bottom : 0) : 0;
  return <View style={fill ? { flex: 1, paddingBottom: padding } : { paddingBottom: padding }}>{children}</View>;
}
