import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, ReduceMotion, SlideInLeft } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, type Href } from "expo-router";

import { SymbolView } from "@/components/SymbolView";
import { GradientFill } from "@/components/gym/GradientFill";
import { comingSoon } from "@/lib/gymPortal";
import { phoneText } from "@/data/gymDashboard";
import { useAuthStore } from "@/store/auth";
import { useThemeColors } from "@/theme";
import type { Icon } from "@/types/profile";

type MenuItem = { label: string; icon: Icon; href?: Href };

const MANAGE: MenuItem[] = [
  { label: "Members", icon: { ios: "person.2.fill", android: "group", web: "group" }, href: "/gym/manage?tab=member" },
  { label: "Plans / Catalogue", icon: { ios: "list.bullet.rectangle", android: "list_alt", web: "list_alt" }, href: "/gym/manage?tab=catalog" },
  { label: "Enquiries", icon: { ios: "bubble.left.and.bubble.right.fill", android: "forum", web: "forum" }, href: "/gym/manage?tab=enquiry" },
  { label: "Expenses", icon: { ios: "doc.text", android: "receipt_long", web: "receipt_long" } },
  { label: "Outlets", icon: { ios: "storefront", android: "storefront", web: "storefront" }, href: "/gym/branches" },
  { label: "Staff / Admin Login", icon: { ios: "person.badge.shield.checkmark", android: "admin_panel_settings", web: "admin_panel_settings" } },
  { label: "Reminder Templates", icon: { ios: "text.bubble.fill", android: "chat", web: "chat" } },
];
const OTHER: MenuItem[] = [
  { label: "Send Bulk SMS", icon: { ios: "ellipsis.message.fill", android: "sms", web: "sms" } },
  { label: "Biometric Attendance", icon: { ios: "touchid", android: "fingerprint", web: "fingerprint" } },
];

// The ☰ side menu over Home: who is signed in and their branch, Manage (Members, Plans /
// Catalogue, Enquiries, Outlets = branches; the rest are on their way), Other, and Sign out.
export function GymMenu({ open, onClose, gymLine }: { open: boolean; onClose: () => void; gymLine: string | null }) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((state) => state.user);
  const name = user?.fullName?.trim() || "Gym admin";

  const go = (item: MenuItem) => {
    onClose();
    if (item.href) router.push(item.href);
    else setTimeout(() => comingSoon(item.label), 250);
  };
  const row = (item: MenuItem) => (
    <Pressable key={item.label} onPress={() => go(item)} className="gym-menu__row" accessibilityRole="button" accessibilityLabel={item.href ? item.label : `${item.label}, coming soon`}>
      <SymbolView name={item.icon} size={20} tintColor={colors.gymInkSoft} />
      <Text className="gym-menu__label flex-1" numberOfLines={1}>{item.label}</Text>
      <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={13} tintColor={colors.gymFaint} />
    </Pressable>
  );

  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)} style={{ flex: 1, backgroundColor: "rgba(17, 24, 39, 0.45)" }}>
        <Pressable style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close menu" />
        <Animated.View entering={SlideInLeft.duration(240).reduceMotion(ReduceMotion.System)} className="gym-menu" style={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, gap: 4 }} showsVerticalScrollIndicator={false}>
            <View className="gym-summary" style={{ marginBottom: 12 }}>
              <GradientFill radius={14} />
              <Text className="gym-tx__name" style={{ color: colors.white }} numberOfLines={1}>{name}</Text>
              {user?.phone ? <Text className="gym-tx__meta" style={{ color: colors.white, opacity: 0.85 }}>{phoneText(user.phone)}</Text> : null}
              {gymLine ? <Text className="gym-tx__meta" style={{ color: colors.white, opacity: 0.85 }} numberOfLines={2}>{gymLine}</Text> : null}
            </View>
            <Text className="gym-menu__section">Manage</Text>
            {MANAGE.map(row)}
            <Text className="gym-menu__section" style={{ marginTop: 12 }}>Other</Text>
            {OTHER.map(row)}
            <Pressable onPress={() => { onClose(); useAuthStore.getState().signOut(); }} className="gym-menu__row" style={{ marginTop: 12 }} accessibilityRole="button" accessibilityLabel="Sign out">
              <SymbolView name={{ ios: "rectangle.portrait.and.arrow.right", android: "logout", web: "logout" }} size={20} tintColor={colors.danger} />
              <Text className="gym-menu__label flex-1" style={{ color: colors.danger }}>Sign out</Text>
            </Pressable>
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
