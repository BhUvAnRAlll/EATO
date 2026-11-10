import { useCallback, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";

import { SymbolView } from "@/components/SymbolView";
import { notificationsApi } from "@/lib/notifications";
import { useSessionToken } from "@/lib/session";
import { useAuthStore } from "@/store/auth";
import { useThemeColors } from "@/theme";

type AdminTabHeaderProps = {
  title: string;
  // A row under the title for the tab's own actions (New gym, Dashboard…), full width
  actions?: ReactNode;
};

// The unread count is shared by every tab and read again at most every 30 s, so switching tabs
// doesn't ask the server each time
let unreadCache: { value: number; at: number } | null = null;

// The top of every Super Admin tab: "justFit admin", the tab's large title, the bell (with the
// unread count) and the admin's initial (Profile), then the tab's own actions. One header for
// Overview, Orders, Gyms, Users and More.
export function AdminTabHeader({ title, actions }: AdminTabHeaderProps) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const name = useAuthStore((state) => state.user?.fullName?.trim()) || "A";
  const [unread, setUnread] = useState<number | null>(unreadCache?.value ?? null);

  useFocusEffect(
    useCallback(() => {
      if (unreadCache && Date.now() - unreadCache.at < 30_000) {
        setUnread(unreadCache.value);
        return;
      }
      let live = true;
      (async () => {
        const result = await notificationsApi.list(await getToken().catch(() => null));
        if (!result.ok) return;
        unreadCache = { value: result.data.unread, at: Date.now() };
        if (live) setUnread(result.data.unread);
      })();
      return () => {
        live = false;
      };
    }, [getToken]),
  );

  const openInbox = () => {
    unreadCache = null; // reading the inbox changes the count
    router.push("/admin/notifications");
  };

  return (
    <View className="admin-header">
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <View className="min-w-0 flex-1">
          <Text className="type-overline text-muted">justFit admin</Text>
          <Text className="type-title text-forest-ink" numberOfLines={1} accessibilityRole="header">{title}</Text>
        </View>
        <Pressable onPress={openInbox} hitSlop={6} className="admin-header__button" accessibilityRole="button" accessibilityLabel={unread ? `Notifications, ${unread} unread` : "Notifications"}>
          <SymbolView name={{ ios: "bell", android: "notifications", web: "notifications" }} size={20} tintColor={colors.forestInk} />
          {unread ? (
            <View className="admin-header__badge">
              <Text className="admin-header__badge-label">{unread > 99 ? "99+" : unread}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable onPress={() => router.push("/admin/profile")} hitSlop={6} className="admin-header__avatar" accessibilityRole="button" accessibilityLabel="Profile">
          <Text className="admin-header__avatar-label">{name.charAt(0).toUpperCase()}</Text>
        </Pressable>
      </View>
      {actions ? <View className="flex-row" style={{ gap: 8 }}>{actions}</View> : null}
    </View>
  );
}
