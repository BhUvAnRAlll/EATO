import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";

import { AdminLinkRow } from "@/components/admin/AdminLinkRow";
import { AdminScreen } from "@/components/admin/AdminScreen";
import { SymbolView } from "@/components/SymbolView";
import { useAuthStore } from "@/store/auth";
import { useThemeColors } from "@/theme";

// Super Admin › Profile: who is signed in, their own inbox, and Sign out. Every admin tool lives on
// the More tab.
export default function AdminProfile() {
  const colors = useThemeColors();
  const user = useAuthStore((state) => state.user);
  const name = user?.fullName?.trim() || "justFit admin";

  return (
    <AdminScreen title="Profile">
      <View style={{ gap: 20 }}>
        <View className="admin-list">
          <View className="admin-row">
            <View className="admin-initials">
              <Text className="admin-initials__label">{name.charAt(0).toUpperCase()}</Text>
            </View>
            <View className="min-w-0 flex-1">
              <Text className="card__title" numberOfLines={1}>{name}</Text>
              <Text className="meta-text" numberOfLines={1}>{user?.phone ? `Super Admin · ${user.phone}` : "Super Admin"}</Text>
            </View>
          </View>
        </View>

        <View className="admin-list">
          <AdminLinkRow icon={{ ios: "bell", android: "notifications", web: "notifications" }} label="Notifications" line="Gyms waiting for review and other alerts" onPress={() => router.push("/admin/notifications")} />
          <AdminLinkRow icon={{ ios: "ellipsis.circle", android: "more_horiz", web: "more_horiz" }} label="All admin tools" line="Meals, kitchens, gyms, content and platform" divided onPress={() => router.navigate("/admin/more")} />
        </View>

        <View className="admin-list">
          <AdminLinkRow icon={{ ios: "doc.text", android: "description", web: "description" }} label="Terms & Conditions" line="What members and gyms agree to" onPress={() => router.push("/legal/terms")} />
          <AdminLinkRow icon={{ ios: "lock.shield", android: "shield_lock", web: "shield_lock" }} label="Privacy Policy" line="How justFit handles personal data" divided onPress={() => router.push("/legal/privacy")} />
        </View>

        <View className="admin-list">
          <Pressable onPress={() => useAuthStore.getState().signOut()} className="admin-row" accessibilityRole="button" accessibilityLabel="Sign out">
            <View className="admin-row__icon admin-row__icon--danger"><SymbolView name={{ ios: "rectangle.portrait.and.arrow.right", android: "logout", web: "logout" }} size={18} tintColor={colors.danger} /></View>
            <Text className="card__title flex-1" style={{ color: colors.danger }}>Sign out</Text>
          </Pressable>
        </View>
      </View>
    </AdminScreen>
  );
}
