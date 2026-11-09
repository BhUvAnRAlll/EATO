import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, ReduceMotion, SlideInLeft } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, type Href } from "expo-router";

import { GymIcon } from "@/components/gym/GymIcon";
import { GradientFill } from "@/components/gym/GradientFill";
import { comingSoon } from "@/lib/gymPortal";
import { phoneText } from "@/data/gymDashboard";
import type { StaffOption } from "@/lib/gymApi";
import { useAuthStore } from "@/store/auth";
import { useCan } from "@/store/gymAccess";
import { useThemeColors } from "@/theme";
import type { GymIconName } from "@/constants/gymIcons";

// need: the Role & Permission option the item opens (a Staff login without it doesn't see the item)
// staffOnly: a Staff login's own item (the gym admin doesn't check in for work)
type MenuItem = { label: string; icon: GymIconName; href?: Href; action?: "sms"; ownerOnly?: boolean; staffOnly?: boolean; need?: StaffOption };

const MANAGE: MenuItem[] = [
  { label: "Members", icon: "users", href: "/gym/members", need: "members.view" },
  { label: "Gym Profile", icon: "store", href: "/gym/profile", need: "profile.view" },
  { label: "Plans / Catalogue", icon: "clipboard-list", href: "/gym/catalog", need: "catalog.view" },
  { label: "Enquiries", icon: "messages-square", href: "/gym/enquiries", need: "enquiries.view" },
  { label: "Likely to leave", icon: "user-x", href: "/gym/predictions/renewals", need: "predictions.renewals" },
  { label: "Expenses", icon: "receipt", href: "/gym/expenses", need: "expenses.view" },
  { label: "Outlets", icon: "store", href: "/gym/branches" },
  { label: "Staff / Admin Login", icon: "user-cog", href: "/gym/staff", ownerOnly: true },
  { label: "Role & Permission", icon: "shield-check", href: "/gym/permissions", ownerOnly: true },
  { label: "Activity", icon: "history", href: "/gym/activity", ownerOnly: true },
  { label: "Reminder Templates", icon: "message-square-text", href: "/gym/templates", need: "templates.view" },
];
const OTHER: MenuItem[] = [
  { label: "Send Bulk SMS", icon: "message-square-more", action: "sms", need: "sms.view" },
  { label: "Attendance", icon: "qr-code", href: "/gym/attendance", need: "attendance.view" },
  { label: "My check-in", icon: "scan-qr-code", href: "/gym/check-in", staffOnly: true },
  { label: "Notifications", icon: "bell", href: "/gym/notifications" },
  { label: "Settings", icon: "settings", href: "/gym/settings" },
];

// The ☰ side menu over Home: who is signed in and their branch, Manage (Members, Plans /
// Catalogue, Enquiries, Likely to leave = the renewal-risk prediction, Outlets = branches, Staff /
// Admin Login, Role & Permission and Activity for the gym admin only, Reminder Templates), Other (Send Bulk SMS opens Home's sheet through onBulkSms; Attendance (its
// location settings are on Attendance and in Settings); My check-in for a Staff login's own day at work; Settings, every setting in one list), and Sign out. A Staff login sees only the areas the gym admin gave them (useCan).
export function GymMenu({ open, onClose, gymLine, onBulkSms, canManageTeam, isStaff = false }: { open: boolean; onClose: () => void; gymLine: string | null; onBulkSms: () => void; canManageTeam: boolean; isStaff?: boolean }) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((state) => state.user);
  const can = useCan();
  const name = user?.fullName?.trim() || "Admin";
  const allowed = (item: MenuItem) => (!item.ownerOnly || canManageTeam) && (!item.staffOnly || isStaff) && (!item.need || can(item.need));

  const go = (item: MenuItem) => {
    onClose();
    if (item.href) router.push(item.href);
    else if (item.action === "sms") onBulkSms();
    else setTimeout(() => comingSoon(item.label), 250);
  };
  const row = (item: MenuItem) => (
    <Pressable key={item.label} onPress={() => go(item)} className="gym-menu__row" accessibilityRole="button" accessibilityLabel={item.href || item.action ? item.label : `${item.label}, coming soon`}>
      <GymIcon name={item.icon} size={20} color={colors.gymInkSoft} />
      <Text className="gym-menu__label flex-1" numberOfLines={1}>{item.label}</Text>
      <GymIcon name="chevron-right" size={13} color={colors.gymFaint} />
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
            {MANAGE.filter(allowed).map(row)}
            <Text className="gym-menu__section" style={{ marginTop: 12 }}>Other</Text>
            {OTHER.filter(allowed).map(row)}
            <Pressable onPress={() => { onClose(); useAuthStore.getState().signOut(); }} className="gym-menu__row" style={{ marginTop: 12 }} accessibilityRole="button" accessibilityLabel="Sign out">
              <GymIcon name="log-out" size={20} color={colors.danger} />
              <Text className="gym-menu__label flex-1" style={{ color: colors.danger }}>Sign out</Text>
            </Pressable>
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
