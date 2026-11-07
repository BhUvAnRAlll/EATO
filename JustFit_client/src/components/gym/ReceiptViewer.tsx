import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GymIcon } from "@/components/gym/GymIcon";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { useThemeColors } from "@/theme";

// The bill attached to a payment (PaymentRow's Bill button): the photo of the receipt, whole, on a
// dark ground, read from the server with the session. Modal and its placing are inline styles
// (the style exception rules).
export function ReceiptViewer({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.immersive }]} accessibilityViewIsModal>
        <View style={{ flex: 1, marginTop: insets.top + 60, marginBottom: insets.bottom + 16, marginHorizontal: 16 }} accessible accessibilityLabel="The payment bill">
          <MemberPhotoImage url={url} fit="contain" />
        </View>
        <View style={{ position: "absolute", top: insets.top + 8, left: 16, right: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Text className="gym-tx__name flex-1" style={{ color: colors.white }} numberOfLines={1}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close the bill" style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.onInverseMuted, alignItems: "center", justifyContent: "center" }}>
            <GymIcon name="x" size={20} color={colors.white} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
