import { useCallback, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect, type Href } from "expo-router";

import { ScreenHeader } from "@/components/ScreenHeader";
import { MetricCard } from "@/components/MetricCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { FormAlert } from "@/components/FormAlert";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { SkeletonCard } from "@/components/Skeleton";
import { accountContact } from "@/lib/me";
import { fetchProfile, type SavedProfile } from "@/lib/profile";
import { scanFieldsFromSaved } from "@/lib/profileScan";
import { useSessionToken } from "@/lib/session";
import { useAuthStore } from "@/store/auth";
import { useSetupStore } from "@/store/setup";
import { useThemeColors } from "@/theme";
import type { Icon } from "@/types/profile";
import { confirmChoice } from "@/lib/nativeSheets";

// The account's places, in the order the reference design lists them (every one is an existing screen)
// Gym Hub has its own card under the member's; a gym's trainer has no membership of their
// own, so they get the check-in there instead (they scan in for work)
const gymHub = { label: "Gym Hub", icon: { ios: "dumbbell", android: "fitness_center", web: "fitness_center" } as Icon, href: "/gym-hub" as Href };
const gymCheckIn = { label: "Gym check-in", icon: { ios: "qrcode.viewfinder", android: "qr_code_scanner", web: "qr_code_scanner" } as Icon, href: "/attendance" as Href };

const menu: { label: string; icon: Icon; href: Href }[] = [
  { label: "Food preferences", icon: { ios: "fork.knife", android: "restaurant", web: "restaurant" }, href: "/food-preferences" },
  { label: "My plans", icon: { ios: "calendar", android: "calendar_month", web: "calendar_month" }, href: "/plans" },
  { label: "Orders", icon: { ios: "shippingbox", android: "inventory_2", web: "inventory_2" }, href: "/orders" },
  { label: "Invite friends", icon: { ios: "gift", android: "redeem", web: "redeem" }, href: "/referrals" },
  { label: "My subscriptions", icon: { ios: "arrow.triangle.2.circlepath", android: "autorenew", web: "autorenew" }, href: "/meals/subscriptions" },
  { label: "Delivery addresses", icon: { ios: "mappin.and.ellipse", android: "location_on", web: "location_on" }, href: "/addresses" },
  { label: "Notifications", icon: { ios: "bell", android: "notifications", web: "notifications" }, href: "/notifications" },
];

// Legal, at the bottom above Sign out (app/legal/[doc].tsx)
const legal: { label: string; icon: Icon; href: Href }[] = [
  { label: "Terms & Conditions", icon: { ios: "doc.text", android: "description", web: "description" }, href: "/legal/terms" },
  { label: "Privacy Policy", icon: { ios: "lock.shield", android: "shield_lock", web: "shield_lock" }, href: "/legal/privacy" },
];

// BMI and its one-word band (WHO adult cut-offs), for the metric tile
function bmiOf(weightKg: number | null | undefined, heightCm: number | null | undefined) {
  if (!weightKg || !heightCm) return null;
  const value = weightKg / (heightCm / 100) ** 2;
  const status = value < 18.5 ? "Underweight" : value < 25 ? "Healthy" : value < 30 ? "Overweight" : "Obese";
  return { value: value.toFixed(1), status };
}

// Profile: the member's card (tap for their body metrics), Gym Hub, the body scan, the account's
// places as a list, and sign out
// The height again in feet and inches ("5′ 8″"), as many people in India say it: a neutral line
// under the number rather than a word that reads like a button
const feetAndInches = (cm: number) => {
  const inches = Math.round(cm / 2.54);
  return `${Math.floor(inches / 12)}′ ${inches % 12}″`;
};


export default function Profile() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((state) => state.user);
  const gym = user?.role === "trainer" ? gymCheckIn : gymHub;
  const [signingOut, setSigningOut] = useState(false);
  const getToken = useSessionToken();
  const lastScan = useSetupStore((state) => state.scan);
  const [saved, setSaved] = useState<SavedProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The body metrics show once the member taps their card
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Reloaded whenever Profile shows, so a scan saved a moment ago appears at once
  const load = useCallback(async () => {
    const result = await fetchProfile(await getToken());
    if (result.ok) {
      setSaved(result.data.profile);
      setLoadError(null);
    } else {
      setLoadError(result.error);
    }
  }, [getToken]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // A pull reads the saved profile again
  const { refreshControl } = usePullToRefresh(load);

  // The scan screens read height, weight, age and gender from the setup store, as in setup:
  // fill it from the saved profile, then open the same instructions → photos → report screens
  const startScan = () => {
    if (!saved) return;
    useSetupStore.getState().update(scanFieldsFromSaved(saved));
    useSetupStore.getState().setScanDraft(null);
    router.push({ pathname: "/setup/scan-guide", params: { from: "profile" } });
  };

  const name = user?.fullName || saved?.fullName || "Member";

  // Ends every session of this account (phones, tablets, the web), this one included. Only
  // counts once the server confirms; if it can't be reached, nothing is signed out.
  const signOutEverywhere = async () => {
    setSigningOut(true);
    const result = await useAuthStore.getState().signOut({ everywhere: true });
    if (result.ok) return;
    setSigningOut(false);
    if (Platform.OS === "web") globalThis.alert?.(result.error);
    else Alert.alert("Couldn't sign out everywhere", result.error);
  };
  const confirmSignOutEverywhere = () => {
    const question = "Sign out of all devices?";
    const detail = "You'll need a code sent to your phone to log in again on each of them.";
    confirmChoice({ title: question, message: detail, confirmLabel: "Sign out everywhere" }).then((ok) => {
      if (ok) signOutEverywhere();
    });
  };
  // The latest report gets its row once there is one this session
  const shortcuts: { label: string; icon: Icon; onPress: () => void; disabled?: boolean }[] = [
    { label: gym.label, icon: gym.icon, onPress: () => router.push(gym.href) },
    { label: "Body Composition Scan", icon: { ios: "figure.stand", android: "accessibility_new", web: "accessibility_new" }, onPress: startScan, disabled: !saved },
    // Every kept scan, photos and report (2026-11-10); the latest report from this session still opens too
    ...(lastScan ? [{ label: "Latest body report", icon: { ios: "doc.text", android: "description", web: "description" } as Icon, onPress: () => router.push("/setup/scan-report?mode=view&from=profile") }] : []),
    // Gym owners apply here; the justFit team approves the gym (a trainer is already a team account)
    ...(user?.role === "user" ? [{ label: "Register your gym", icon: { ios: "building.2", android: "storefront", web: "storefront" } as Icon, onPress: () => router.push("/gym-register") }] : []),
  ];
  const bmi = bmiOf(saved?.weightKg, saved?.heightCm);
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScreenHeader title="Profile" showBack={router.canGoBack()} />

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 + insets.bottom }} showsVerticalScrollIndicator={false} refreshControl={refreshControl}>
          {/* Personal details: the member's card; tapping it opens their body metrics under it */}
          <View className="card">
            <Pressable
              onPress={() => setDetailsOpen((open) => !open)}
              className="flex-row items-center gap-3.5"
              accessibilityRole="button"
              accessibilityState={{ expanded: detailsOpen }}
              accessibilityHint="Shows your weight, height, BMI and body fat"
            >
              <View className="home__avatar" style={{ width: 56, height: 56 }}>
                <Text className="home__avatar-label" style={{ fontSize: 22, lineHeight: 28 }}>
                  {initial}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="type-headline text-ink" numberOfLines={1}>
                  {name}
                </Text>
                <Text className="type-caption text-muted" numberOfLines={2}>
                  {accountContact(user) || "Member"}
                </Text>
              </View>
              <SymbolView
                name={detailsOpen ? { ios: "chevron.up", android: "keyboard_arrow_up", web: "keyboard_arrow_up" } : { ios: "chevron.down", android: "keyboard_arrow_down", web: "keyboard_arrow_down" }}
                size={14}
                tintColor={colors.faint}
              />
            </Pressable>

            {detailsOpen && (
              <View className="mt-4 gap-3">
              {/* Until the first read answers, the metric tiles are a skeleton rather than "—" and "Add",
                  which read as missing data; a failed first read says so and can be asked again */}
              {saved === null && loadError === null && <SkeletonCard tall />}
              {saved === null && loadError !== null && (
                <View className="gap-3">
                  <FormAlert message={loadError} />
                  <PrimaryButton label="Try again" onPress={() => { setLoadError(null); load(); }} />
                </View>
              )}
              {loadError && saved !== null && <Text className="type-caption text-muted">{loadError}</Text>}
              {saved !== null && (
                <View className="gap-3">
                  <View className="flex-row gap-3">
                    <MetricCard
                      tone="green"
                      label="Weight"
                      icon={{ ios: "scalemass", android: "monitor_weight", web: "monitor_weight" }}
                      value={saved.weightKg != null ? String(saved.weightKg) : "—"}
                      unit="kg"
                      status={bmi ? bmi.status : "Add"}
                      onPress={() => router.push("/measurements")}
                    />
                    <MetricCard
                      tone="blue"
                      label="Height"
                      icon={{ ios: "ruler", android: "straighten", web: "straighten" }}
                      value={saved.heightCm != null ? String(saved.heightCm) : "—"}
                      unit="cm"
                      status={saved.heightCm != null ? feetAndInches(saved.heightCm) : "Add"}
                      onPress={() => router.push("/measurements")}
                    />
                  </View>
                  <View className="flex-row gap-3">
                    <MetricCard
                      tone="peach"
                      label="BMI"
                      icon={{ ios: "heart", android: "favorite", web: "favorite" }}
                      value={bmi ? bmi.value : "—"}
                      status={bmi ? bmi.status : "Needs data"}
                      onPress={() => router.push("/measurements")}
                    />
                    <MetricCard
                      tone="lavender"
                      label="Body fat"
                      icon={{ ios: "figure.stand", android: "accessibility_new", web: "accessibility_new" }}
                      value={saved.bodyFatPercent != null ? String(saved.bodyFatPercent) : "—"}
                      unit="%"
                      status={saved.bodyFatPercent != null ? "Scanned" : "Not yet"}
                      onPress={startScan}
                    />
                  </View>
                </View>
              )}
              </View>
            )}
          </View>

          {/* Gym Hub (a trainer's check-in) and the body scan: rows like the account's places */}
          <View className="card mt-4 py-1">
            {shortcuts.map((item, index) => (
              <Pressable
                key={item.label}
                onPress={item.onPress}
                disabled={item.disabled}
                className="list-row"
                style={index === shortcuts.length - 1 ? { borderBottomWidth: 0 } : undefined}
                accessibilityRole="button"
              >
                <SymbolView name={item.icon} size={19} tintColor={colors.forestInk} />
                <Text className="list-row__label">{item.label}</Text>
                <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
              </Pressable>
            ))}
          </View>

          {/* The account's places */}
          <View className="card mt-4 py-1">
            {menu.map((item, index) => (
              <Pressable
                key={item.label}
                onPress={() => router.push(item.href)}
                className="list-row"
                style={index === menu.length - 1 ? { borderBottomWidth: 0 } : undefined}
                accessibilityRole="button"
              >
                <SymbolView name={item.icon} size={19} tintColor={colors.forestInk} />
                <Text className="list-row__label">{item.label}</Text>
                <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
              </Pressable>
            ))}
          </View>

          <View className="card mt-4 py-1">
            {legal.map((item, index) => (
              <Pressable
                key={item.label}
                onPress={() => router.push(item.href)}
                className="list-row"
                style={index === legal.length - 1 ? { borderBottomWidth: 0 } : undefined}
                accessibilityRole="button"
              >
                <SymbolView name={item.icon} size={19} tintColor={colors.forestInk} />
                <Text className="list-row__label">{item.label}</Text>
                <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
              </Pressable>
            ))}
          </View>

          {/* Signing out removes these screens; the start screen then opens onboarding. The scan
              copied this member's height, weight and date of birth into the setup store; signing
              out clears it, so it can't pre-fill the next account's setup on this phone */}
          <Pressable
            onPress={async () => {
              setSigningOut(true);
              await useAuthStore.getState().signOut();
            }}
            disabled={signingOut}
            className="btn-outline mt-5"
            accessibilityRole="button"
          >
            <Text className="btn-outline__label">Sign out</Text>
          </Pressable>
          <Pressable onPress={confirmSignOutEverywhere} disabled={signingOut} className="mt-3 self-center p-2" accessibilityRole="button">
            <Text className="auth__note-link">Sign out of all devices</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
