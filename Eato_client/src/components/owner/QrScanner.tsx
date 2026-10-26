import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { SymbolView } from "expo-symbols";

import { colors } from "@/theme";

type Props = {
  visible: boolean;
  title: string;
  hint: string;
  onCode: (code: string) => void;
  onClose: () => void;
};

// A full-screen QR scanner: the camera on a phone (a development build has expo-camera), with a
// field to type or paste the code instead (web, no camera access, or a code read aloud). Reports
// the first code it sees once per opening, so a code held in view doesn't fire many times.
export function QrScanner({ visible, title, hint, onCode, onClose }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [typed, setTyped] = useState("");
  const reported = useRef(false);
  const camera = Platform.OS !== "web" && permission?.granted === true;

  useEffect(() => {
    if (!visible) return;
    reported.current = false;
    if (Platform.OS !== "web" && permission && !permission.granted && permission.canAskAgain) requestPermission();
  }, [visible, permission, requestPermission]);

  const report = (code: string) => {
    const clean = code.trim();
    if (!clean || reported.current) return;
    reported.current = true;
    setTyped("");
    onCode(clean);
  };

  return (
    // No slide on the web: a closing slide that's cut short by a navigation leaves the modal stuck
    <Modal visible={visible} animationType={Platform.OS === "web" ? "none" : "slide"} onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.forestInk }}>
        {camera && <CameraView style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={(result: BarcodeScanningResult) => report(result.data)} />}
        <SafeAreaView style={{ flex: 1 }}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
            <View className="h-12 flex-row items-center px-4">
              <Pressable onPress={onClose} hitSlop={10} className="owner__header-button" accessibilityRole="button" accessibilityLabel="Close the scanner">
                <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={20} tintColor={colors.white} />
              </Pressable>
              <Text className="owner-scan__title">{title}</Text>
              <View className="owner__header-button" />
            </View>
            <View className="flex-1 items-center justify-center gap-5 px-8">
              <View className="owner-scan__frame" />
              <Text className="owner-scan__hint">{camera ? hint : Platform.OS === "web" ? "The camera scanner works in the JustFit app on a phone. Type or paste the code below." : "Allow camera access in Settings to scan, or type the code below."}</Text>
            </View>
            <View className="owner-scan__sheet">
              <TextInput
                value={typed}
                onChangeText={setTyped}
                onSubmitEditing={() => report(typed)}
                placeholder="Type or paste a code"
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                accessibilityLabel="Code"
                style={{ flex: 1, height: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.creamLine, backgroundColor: colors.white, paddingHorizontal: 14, fontSize: 15, color: colors.forestInk }}
              />
              <Pressable onPress={() => report(typed)} disabled={!typed.trim()} className="owner-quick owner-quick--primary" style={{ height: 48, opacity: typed.trim() ? 1 : 0.5 }} accessibilityRole="button" accessibilityLabel="Use this code">
                <Text className="owner-quick__label owner-quick__label--primary">Use</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
