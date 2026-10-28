import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect, type Href } from "expo-router";
import { useClerk, useUser } from "@clerk/expo";

import { IconButton } from "@/components/IconButton";
import { MetricCard } from "@/components/MetricCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { fetchProfile, type SavedProfile } from "@/lib/profile";
import { scanFieldsFromSaved } from "@/lib/profileScan";
import { useSessionToken } from "@/lib/session";
import { useSetupStore } from "@/store/setup";
import { colors } from "@/theme";
import type { Icon } from "@/types/profile";

// The account's places, in the order the reference design lists them (every one is an existing screen)
const menu: { label: string; icon: Icon; href: Href }[] = [
  { label: "Workout", icon: { ios: "dumbbell", android: "fitness_center", web: "fitness_center" }, href: "/workout" },
  { label: "My goals", icon: { ios: "target", android: "track_changes", web: "track_changes" }, href: "/goals" },
  { label: "My plans", icon: { ios: "calendar", android: "calendar_month", web: "calendar_month" }, href: "/plans" },
  { label: "Orders", icon: { ios: "shippingbox", android: "inventory_2", web: "inventory_2" }, href: "/orders" },
  { label: "Delivery addresses", icon: { ios: "mappin.and.ellipse", android: "location_on", web: "location_on" }, href: "/addresses" },
  { label: "Notifications", icon: { ios: "bell", android: "notifications", web: "notifications" }, href: "/notifications" },
  { label: "My QR code", icon: { ios: "qrcode", android: "qr_code", web: "qr_code" }, href: "/my-qr" },
  { label: "Messages", icon: { ios: "bubble.left.and.bubble.right", android: "forum", web: "forum" }, href: "/messages" },
  { label: "My trainer", icon: { ios: "person.badge.shield.checkmark", android: "verified_user", web: "verified_user" }, href: "/community/trainers/mine" },
];

// BMI and its one-word band (WHO adult cut-offs), for the metric tile
function bmiOf(weightKg: number | null | undefined, heightCm: number | null | undefined) {
  if (!weightKg || !heightCm) return null;
  const value = weightKg / (heightCm / 100) ** 2;
  const status = value < 18.5 ? "Underweight" : value < 25 ? "Healthy" : value < 30 ? "Overweight" : "Obese";
  return { value: value.toFixed(1), status };
}

// Profile: the member's card with body fat, weight and height, the body scan, the account's
// places as a list, and sign out
export default function Profile() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const getToken = useSessionToken();
  const lastScan = useSetupStore((state) => state.scan);
  const [saved, setSaved] = useState<SavedProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Reloaded whenever Profile shows, so a scan saved a moment ago appears at once
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const result = await fetchProfile(await getToken());
        if (!active) return;
        if (result.ok) {
          setSaved(result.data.profile);
          setLoadError(null);
        } else {
          setLoadError(result.error);
        }
      })();
      return () => {
        active = false;
      };
    }, [getToken]),
  );

  // The scan screens read height, weight, age and gender from the setup store, as in setup:
  // fill it from the saved profile, then open the same instructions → photos → report screens
  const startScan = () => {
    if (!saved) return;
    useSetupStore.getState().update(scanFieldsFromSaved(saved));
    useSetupStore.getState().setScanDraft(null);
    router.push("/setup/scan-guide?from=profile");
  };

  const name = user?.fullName || saved?.fullName || "Member";
  const bmi = bmiOf(saved?.weightKg, saved?.heightCm);
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View className="app-bar px-4">
          {router.canGoBack() ? (
            <IconButton icon={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} label="Back" onPress={() => router.back()} />
          ) : (
            <View style={{ width: 44 }} />
          )}
          <Text className="app-bar__title">Profile</Text>
          <IconButton icon={{ ios: "pencil", android: "edit", web: "edit" }} label="Edit height and weight" onPress={() => router.push("/measurements")} disabled={!saved} />
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
          {/* The member */}
          <View className="card flex-row items-center gap-3.5">
            <View className="home__avatar" style={{ width: 56, height: 56 }}>
              <Text className="home__avatar-label" style={{ fontSize: 22, lineHeight: 28 }}>
                {initial}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="type-headline text-ink" numberOfLines={1}>
                {name}
              </Text>
              <Text className="type-caption text-muted" numberOfLines={1}>
                {user?.primaryEmailAddress?.emailAddress ?? "Member"}
              </Text>
            </View>
          </View>

          {/* Body metrics: two per row, each in its own tone */}
          <View className="mt-3 gap-3">
            <View className="flex-row gap-3">
              <MetricCard
                tone="green"
                label="Weight"
                icon={{ ios: "scalemass", android: "monitor_weight", web: "monitor_weight" }}
                value={saved?.weightKg != null ? String(saved.weightKg) : "—"}
                unit="kg"
                status={bmi ? bmi.status : "Add"}
                onPress={saved ? () => router.push("/measurements") : undefined}
              />
              <MetricCard
                tone="blue"
                label="Height"
                icon={{ ios: "ruler", android: "straighten", web: "straighten" }}
                value={saved?.heightCm != null ? String(saved.heightCm) : "—"}
                unit="cm"
                status={saved?.heightCm != null ? "Set" : "Add"}
                onPress={saved ? () => router.push("/measurements") : undefined}
              />
            </View>
            <View className="flex-row gap-3">
              <MetricCard
                tone="peach"
                label="BMI"
                icon={{ ios: "heart", android: "favorite", web: "favorite" }}
                value={bmi ? bmi.value : "—"}
                unit="BMI"
                status={bmi ? bmi.status : "Needs data"}
                onPress={saved ? () => router.push("/measurements") : undefined}
              />
              <MetricCard
                tone="lavender"
                label="Body fat"
                icon={{ ios: "figure.stand", android: "accessibility_new", web: "accessibility_new" }}
                value={saved?.bodyFatPercent != null ? String(saved.bodyFatPercent) : "—"}
                unit="%"
                status={saved?.bodyFatPercent != null ? "Scanned" : "Not yet"}
                onPress={saved ? startScan : undefined}
              />
            </View>
          </View>

          {/* Body composition: the photo scan */}
          <View className="card mt-4 gap-3">
            <View className="flex-row items-center gap-3">
              <View className="card__icon">
                <SymbolView name={{ ios: "figure.stand", android: "accessibility_new", web: "accessibility_new" }} size={20} tintColor={colors.leaf} />
              </View>
              <View className="flex-1">
                <Text className="card__title">Body composition</Text>
                <Text className="card__subtitle">{saved?.bodyFatPercent != null ? `Body fat ${saved.bodyFatPercent}%` : "No body scan yet"}</Text>
              </View>
            </View>
            <Text className="type-caption text-muted">
              Two photos give you a full body composition report. Saving it updates your body fat % and your daily targets. Your photos are never stored.
            </Text>
            {loadError && <Text className="type-caption text-muted">{loadError}</Text>}
            <PrimaryButton label="Scan Body" onPress={startScan} disabled={!saved} />
            {lastScan && (
              <Pressable onPress={() => router.push("/setup/scan-report?mode=view&from=profile")} accessibilityRole="button" hitSlop={8} className="self-center">
                <Text className="auth__link">View latest report</Text>
              </Pressable>
            )}
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

          {/* Signing out removes these screens; the start screen then opens onboarding. The scan
              copied this member's height, weight and date of birth into the setup store, so it is
              cleared first and can't pre-fill the next account's setup on this phone */}
          <Pressable
            onPress={() => {
              useSetupStore.getState().reset();
              signOut();
            }}
            className="btn-outline mt-5"
          >
            <Text className="btn-outline__label">Sign out</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
