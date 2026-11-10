import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Switch, Text, View } from "react-native";
import { router, useFocusEffect, type Href } from "expo-router";

import { EmptyState } from "@/components/EmptyState";
import { FormAlert } from "@/components/FormAlert";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenSkeleton } from "@/components/Skeleton";
import { haptic } from "@/lib/haptics";
import { categoriesFor, notificationsApi, safeLink, whenText, type AppNotification, type NotificationCategory, type NotificationPage, type NotificationPrefs } from "@/lib/notifications";
import { useSessionToken } from "@/lib/session";
import { useAuthStore } from "@/store/auth";
import { useSwitchColors, useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; data: NotificationPage };

// The inbox every role shares (member app, gym portal, Super Admin): newest first, unread marked,
// tapping one marks it read and opens its screen (only screens on the allowed list), Mark all read,
// Show more, and the categories this account can switch off. Read again each time the screen shows.
export function NotificationInbox() {
  const colors = useThemeColors();
  const switchColors = useSwitchColors();
  const getToken = useSessionToken();
  const role = useAuthStore((state) => state.user?.role);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const read = useCallback(async () => {
    const token = await getToken().catch(() => null);
    const [answer, p] = await Promise.all([notificationsApi.list(token), notificationsApi.preferences(token)]);
    setNow(Date.now());
    if (answer.ok) setLoad({ state: "ready", data: answer.data });
    else setLoad((current) => (current.state === "ready" ? current : { state: "failed", error: answer.error }));
    if (p.ok) setPrefs(p.data);
  }, [getToken]);
  useFocusEffect(useCallback(() => { read(); }, [read]));

  const open = async (n: AppNotification) => {
    if (!n.read) {
      setLoad((c) => (c.state === "ready" ? { state: "ready", data: { ...c.data, unread: Math.max(0, c.data.unread - 1), notifications: c.data.notifications.map((x) => (x.id === n.id ? { ...x, read: true } : x)) } } : c));
      notificationsApi.read(await getToken().catch(() => null), { ids: [n.id] });
    }
    const link = safeLink(n.link);
    if (link) router.push(link as Href);
  };
  const readAll = async () => {
    haptic.select();
    const answer = await notificationsApi.read(await getToken().catch(() => null), { all: true });
    if (!answer.ok) return setError(answer.error);
    setLoad((c) => (c.state === "ready" ? { state: "ready", data: { ...c.data, unread: 0, notifications: c.data.notifications.map((x) => ({ ...x, read: true })) } } : c));
  };
  const more = async (data: NotificationPage) => {
    if (!data.nextPage) return;
    const answer = await notificationsApi.list(await getToken().catch(() => null), data.nextPage);
    if (answer.ok) setLoad({ state: "ready", data: { ...answer.data, notifications: [...data.notifications, ...answer.data.notifications] } });
  };
  const toggle = async (id: NotificationCategory, on: boolean) => {
    if (!prefs) return;
    const muted = on ? prefs.muted.filter((c) => c !== id) : [...prefs.muted, id];
    setPrefs({ ...prefs, muted });
    const answer = await notificationsApi.savePreferences(await getToken().catch(() => null), muted);
    if (answer.ok) setPrefs(answer.data);
    else setError(answer.error);
  };

  const shown = categoriesFor(role);
  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await read(); setRefreshing(false); }} tintColor={colors.leaf} colors={[colors.leaf]} />}
      showsVerticalScrollIndicator={false}
    >
      {load.state === "loading" ? <ScreenSkeleton cards={3} label="Loading notifications" /> : null}
      {load.state === "failed" ? (
        <View className="card" style={{ gap: 12 }}>
          <FormAlert message={load.error} />
          <PrimaryButton label="Try again" onPress={read} />
        </View>
      ) : null}
      {load.state === "ready" ? (
        <>
          {load.data.unread > 0 ? (
            <View className="flex-row items-center">
              <Text className="type-caption text-muted flex-1">{`${load.data.unread} unread`}</Text>
              <Pressable onPress={readAll} hitSlop={8} accessibilityRole="button" accessibilityLabel="Mark all as read">
                <Text className="type-caption text-primary-text">Mark all as read</Text>
              </Pressable>
            </View>
          ) : null}
          {error ? <FormAlert message={error} /> : null}
          {load.data.notifications.length === 0 ? (
            <EmptyState icon={{ ios: "bell", android: "notifications", web: "notifications" }} title="Nothing yet" message="Updates about your memberships, pause requests and gyms show here." />
          ) : (
            load.data.notifications.map((n) => (
              <Pressable
                key={n.id}
                onPress={() => open(n)}
                className="card"
                style={{ gap: 4, borderLeftWidth: n.read ? 0 : 3, borderLeftColor: colors.primary }}
                accessibilityRole="button"
                accessibilityLabel={`${n.read ? "" : "Unread. "}${n.title}. ${n.body}. ${whenText(n.at, now)}`}
              >
                <View className="flex-row items-center" style={{ gap: 8 }}>
                  <Text className={n.read ? "type-body text-ink flex-1" : "card__title flex-1"} numberOfLines={1}>{n.title}</Text>
                  <Text className="type-caption text-faint">{whenText(n.at, now)}</Text>
                </View>
                <Text className="type-body text-muted">{n.body}</Text>
              </Pressable>
            ))
          )}
          {load.data.nextPage ? <PrimaryButton label="Show more" onPress={() => more(load.data)} /> : null}

          {/* Members don't choose (2026-11-10): their gym and justFit decide which notices they get */}
          {prefs && prefs.canChoose === false ? (
            <Text className="type-caption mt-2 text-center text-muted">Your gym and justFit choose which updates you get here.</Text>
          ) : null}
          {prefs && prefs.canChoose !== false ? (
            <View className="card mt-2" style={{ gap: 10 }}>
              <Text className="setup__section">Notify me about</Text>
              {prefs.categories.filter((c) => shown.includes(c.id)).map((c) => (
                <View key={c.id} className="flex-row items-center" style={{ gap: 12 }}>
                  <Text className="type-body text-ink flex-1">{c.label}</Text>
                  <Switch value={!prefs.muted.includes(c.id)} onValueChange={(on) => toggle(c.id, on)} {...switchColors} accessibilityLabel={c.label} />
                </View>
              ))}
              <Text className="type-caption text-muted">{"Shown here in the app. justFit doesn't send push notifications yet."}</Text>
            </View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
