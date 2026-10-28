import { useCallback, useState } from "react";
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { SymbolView } from "@/components/SymbolView";

import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { OwnerHeader } from "@/components/owner/OwnerHeader";
import { QrScanner } from "@/components/owner/QrScanner";
import { isOffline } from "@/lib/community";
import { durationLabel, owner, refusalTitles, timeLabel, type ActivityItem, type AttendanceToday, type Visit } from "@/lib/owner";
import { useSessionToken } from "@/lib/session";
import { useOwnerStore } from "@/store/owner";
import type { Icon } from "@/types/profile";
import { colors } from "@/theme";

// A row in "Checked in now" or "Completed today", opening the visit
function VisitRow({ visit, first, last }: { visit: Visit; first: boolean; last: boolean }) {
  const open = visit.checkedOutAt === null;
  const when = open ? `${timeLabel(visit.checkedInAt)} · ${durationLabel(visit.minutes)}` : `${timeLabel(visit.checkedInAt)}–${timeLabel(visit.checkedOutAt!)} · ${durationLabel(visit.minutes)}`;
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/owner/visit/[id]", params: { id: visit.id } })}
      className={`friend-row ${first ? "friend-row--first" : ""} ${last ? "friend-row--last" : ""}`}
      accessibilityRole="button"
      accessibilityLabel={`${visit.member.name}, ${open ? "checked in" : "checked out"}, ${when}`}
    >
      <Avatar member={visit.member} size={40} />
      <View className="min-w-0 flex-1">
        <Text className="friend-row__name" numberOfLines={1}>{visit.member.name}</Text>
        <Text className="friend-row__note" numberOfLines={1}>{when}</Text>
      </View>
      <View className={open ? "owner-badge owner-badge--accent" : "owner-badge"}>
        <Text className="owner-badge__label">{open ? "Checked in" : "Checked out"}</Text>
      </View>
    </Pressable>
  );
}

const activityIcon: Record<ActivityItem["kind"], Icon> = {
  in: { ios: "arrow.right.to.line", android: "login", web: "login" },
  out: { ios: "arrow.left.to.line", android: "logout", web: "logout" },
  failed: { ios: "exclamationmark.triangle", android: "warning", web: "warning" },
};
function activityText(item: ActivityItem): string {
  if (item.kind === "in") return `${item.member.name} checked in`;
  if (item.kind === "out") return `${item.member.name} checked out · ${durationLabel(item.minutes)}`;
  return item.member ? `${refusalTitles[item.reason]} · ${item.member.name}` : refusalTitles[item.reason];
}

// Check-in: scan member QR codes at the front desk, the gym's check-out QR, who is in the gym
// now, who finished today, and today's activity (failed scans included)
export default function OwnerCheckin() {
  const getToken = useSessionToken();
  const gymId = useOwnerStore((state) => state.gymId);
  const setScan = useOwnerStore((state) => state.setScan);
  const rescan = useOwnerStore((state) => state.rescan);
  const setRescan = useOwnerStore((state) => state.setRescan);
  const [data, setData] = useState<AttendanceToday | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const tileWidth = useWindowDimensions().width < 360 ? "45%" : "46%";

  const load = useCallback(async () => {
    if (!gymId) return;
    const result = await owner.today(await getToken(), gymId);
    if (result.ok) {
      setData(result.data);
      setError(null);
    } else setError(result.error);
  }, [gymId, getToken]);

  // Each time the tab shows, and every 30 seconds while it does (durations tick, people arrive)
  useFocusEffect(
    useCallback(() => {
      const first = setTimeout(load, 0);
      const timer = setInterval(load, 30000);
      return () => {
        clearTimeout(first);
        clearInterval(timer);
      };
    }, [load]),
  );

  // Back from verification with "Scan again" or "Scan next member": open the scanner
  useFocusEffect(
    useCallback(() => {
      if (!rescan) return;
      // Clear the request inside the timer: clearing it first would re-run this and cancel it
      const timer = setTimeout(() => {
        setRescan(false);
        setScanning(true);
      }, 0);
      return () => clearTimeout(timer);
    }, [rescan, setRescan]),
  );

  const scanned = (code: string) => {
    setScanning(false);
    setScan(code);
    // Let the scanner finish closing before the next screen slides in (a phone animates it)
    setTimeout(() => router.push("/owner/verify"), Platform.OS === "web" ? 0 : 350);
  };

  const tiles = data
    ? [
        { label: "In the gym now", value: data.counts.inNow, icon: { ios: "person.2", android: "group", web: "group" } as Icon, tone: "accent" },
        { label: "Check-ins today", value: data.counts.checkinsToday, icon: { ios: "calendar.badge.checkmark", android: "event_available", web: "event_available" } as Icon, tone: "plain" },
        { label: "Completed sessions", value: data.counts.completedToday, icon: { ios: "clock", android: "schedule", web: "schedule" } as Icon, tone: "plain" },
        { label: "Failed scans today", value: data.counts.failedToday, icon: { ios: "person.crop.circle.badge.xmark", android: "person_off", web: "person_off" } as Icon, tone: data.counts.failedToday > 0 ? "warning" : "plain" },
      ]
    : [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.forest} />}
      >
        <OwnerHeader title="Check-in" subtitle="Scan member QR codes at the front desk and see who's in the gym." />
        <View className="mx-5 mt-4 flex-row gap-3">
          <Pressable onPress={() => setScanning(true)} className="owner-quick owner-quick--primary flex-1" style={{ height: 48 }} accessibilityRole="button" accessibilityLabel="Scan member QR">
            <SymbolView name={{ ios: "qrcode.viewfinder", android: "qr_code_scanner", web: "qr_code_scanner" }} size={18} tintColor={colors.white} />
            <Text className="owner-quick__label owner-quick__label--primary">Scan member QR</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/owner/checkout-qr")} className="owner-quick flex-1" style={{ height: 48 }} accessibilityRole="button" accessibilityLabel="Check-out QR">
            <SymbolView name={{ ios: "qrcode", android: "qr_code_2", web: "qr_code_2" }} size={18} tintColor={colors.ink} />
            <Text className="owner-quick__label">Check-out QR</Text>
          </Pressable>
        </View>

        {!data ? (
          <View className="mt-8 px-5">
            {error ? (
              <EmptyState icon={isOffline(error) ? { ios: "wifi.slash", android: "wifi_off", web: "wifi_off" } : { ios: "exclamationmark.triangle", android: "error_outline", web: "error_outline" }} title={isOffline(error) ? "You're offline" : "Couldn't load"} text={error} actionLabel="Retry" onAction={load} />
            ) : (
              <ActivityIndicator color={colors.forest} />
            )}
          </View>
        ) : (
          <>
            <View className="mx-5 mt-4 flex-row flex-wrap gap-3">
              {tiles.map((tile) => (
                <View key={tile.label} className={tile.tone === "accent" ? "owner-stat owner-stat--accent" : tile.tone === "warning" ? "owner-stat owner-stat--highlight" : "owner-stat"} style={{ minWidth: tileWidth }} accessibilityLabel={`${tile.label}: ${tile.value}`}>
                  <SymbolView name={tile.icon} size={18} tintColor={tile.tone === "warning" ? colors.warning : colors.ink} />
                  <Text className="owner-stat__label" numberOfLines={2}>{tile.label}</Text>
                  <Text className="owner-stat__value">{tile.value}</Text>
                </View>
              ))}
            </View>

            <View className="mx-5 mt-6 flex-row items-center justify-between">
              <Text className="gym-section__title">Checked in now ({data.inNow.length})</Text>
              <Pressable onPress={() => router.push("/owner/today")} hitSlop={8} accessibilityRole="button" accessibilityLabel="Today's list">
                <Text className="gym-section__link">Today&apos;s list</Text>
              </Pressable>
            </View>
            <View className="mx-5 mt-3">
              {data.inNow.length === 0 ? (
                <View className="owner-card"><Text className="friend-row__note">Nobody is checked in right now. Scan a member&apos;s QR code to check them in.</Text></View>
              ) : (
                data.inNow.map((visit, i) => <VisitRow key={visit.id} visit={visit} first={i === 0} last={i === data.inNow.length - 1} />)
              )}
            </View>

            {data.completedToday.length > 0 && (
              <>
                <Text className="gym-section__title mx-5 mt-6">Completed today ({data.completedToday.length})</Text>
                <View className="mx-5 mt-3">
                  {data.completedToday.map((visit, i) => <VisitRow key={visit.id} visit={visit} first={i === 0} last={i === data.completedToday.length - 1} />)}
                </View>
              </>
            )}

            <Text className="gym-section__title mx-5 mt-6">Recent activity</Text>
            <View className="mx-5 mt-3">
              {data.activity.length === 0 ? (
                <View className="owner-card"><Text className="friend-row__note">Check-ins, check-outs and failed scans from today show here.</Text></View>
              ) : (
                data.activity.map((item, i) => (
                  <View key={`${item.kind}-${item.at}-${i}`} className={`friend-row ${i === 0 ? "friend-row--first" : ""} ${i === data.activity.length - 1 ? "friend-row--last" : ""}`}>
                    <View className={item.kind === "failed" ? "owner-icon" : "owner-icon owner-icon--neutral"}>
                      <SymbolView name={activityIcon[item.kind]} size={16} tintColor={item.kind === "failed" ? colors.warning : colors.ink} />
                    </View>
                    <Text className="friend-row__note min-w-0 flex-1" style={{ color: colors.ink }} numberOfLines={2}>{activityText(item)}</Text>
                    <Text className="friend-row__note">{timeLabel(item.at)}</Text>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
      <QrScanner visible={scanning} title="Attendance scanner" hint="Point the camera at the member's QR code" onCode={scanned} onClose={() => setScanning(false)} />
    </SafeAreaView>
  );
}
