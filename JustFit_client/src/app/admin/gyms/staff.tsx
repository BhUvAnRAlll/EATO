import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { PrimaryButton } from "@/components/PrimaryButton";
import { AdminStackHeader } from "@/components/admin/AdminStackHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { adminPlatform, type StaffDirectory, type StaffRole } from "@/lib/adminPlatform";
import { haptic } from "@/lib/haptics";
import { useSessionToken } from "@/lib/session";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";
import { fonts } from "@/constants/fonts";

const ROLES: { id: StaffRole; label: string }[] = [
  { id: "all", label: "Everyone" },
  { id: "owner", label: "Gym owners" },
  { id: "staff", label: "Staff" },
  { id: "trainer", label: "Trainers" },
];

// Super Admin › Gyms › All staff (the brief's section 7): every gym's owners, Staff (with their role:
// Gym Admin, Manager, Receptionist, Attendance Staff or Custom) and trainers, searchable by name or
// gym. A row opens the account, where it can be suspended (a misused or compromised login).
export default function PlatformStaff() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [role, setRole] = useState<StaffRole>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const load = useCallback((token: string | null) => adminPlatform.staff(token, { role, search: query }), [role, query]);
  const { result, retry, refreshing, refresh, update } = useGymData(load);
  const [loadingMore, setLoadingMore] = useState(false);

  const more = async (data: StaffDirectory) => {
    if (!data.nextPage || loadingMore) return;
    setLoadingMore(true);
    const answer = await adminPlatform.staff(await getToken().catch(() => null), { role, search: query, page: data.nextPage });
    setLoadingMore(false);
    if (answer.ok) update((c) => ({ ...answer.data, staff: [...c.staff, ...answer.data.staff] }));
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <AdminStackHeader title="All gym staff" fallback="/admin/gyms" />
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.leaf} colors={[colors.leaf]} />}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="setup__field">
            <TextInput
              value={search}
              onChangeText={setSearch}
              onSubmitEditing={() => setQuery(search.trim())}
              returnKeyType="search"
              placeholder="Search by name or gym"
              placeholderTextColor={colors.faint}
              style={{ flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.ink, paddingVertical: 10 }}
              accessibilityLabel="Search by name or gym"
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {ROLES.map((r) => (
              <Pressable key={r.id} onPress={() => { haptic.select(); setRole(r.id); }} className={role === r.id ? "admin-chip admin-chip--on" : "admin-chip"} accessibilityRole="button" accessibilityState={{ selected: role === r.id }}>
                <Text className="type-caption text-ink">{r.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {result.state === "loading" ? <ScreenSkeleton cards={3} label="Loading staff" /> : null}
          {result.state === "failed" ? <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load staff" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} /> : null}
          {result.state === "ready" ? (
            result.data.staff.length === 0 ? (
              <DashedBlock icon={{ ios: "person.2", android: "group", web: "group" }} title="Nobody here" text="No gym staff match." onPress={() => { setRole("all"); setSearch(""); setQuery(""); }} />
            ) : (
              <View className="admin-list">
                {result.data.staff.map((s, i) => (
                  <Pressable
                    key={`${s.userId}-${s.gym.id}`}
                    onPress={() => router.push({ pathname: "/admin/users/[userId]", params: { userId: s.userId } })}
                    className={i === 0 ? "admin-row" : "admin-row admin-row--divided"}
                    accessibilityRole="button"
                    accessibilityLabel={`${s.name ?? "No name"}, ${s.roleLabel} at ${s.gym.name} ${s.gym.branch}${s.suspended ? ", suspended" : ""}`}
                  >
                    <View className="min-w-0 flex-1">
                      <Text className="card__title" numberOfLines={1}>{s.name ?? "No name yet"}</Text>
                      <Text className="meta-text" numberOfLines={1}>{`${s.roleLabel} · ${s.gym.name}, ${s.gym.branch}`}</Text>
                      <Text className="meta-text" numberOfLines={1}>{`${s.phone ?? ""}${s.addedOn ? ` · since ${s.addedOn}` : ""}`}</Text>
                    </View>
                    {s.suspended ? <Text className="type-caption text-danger">Suspended</Text> : null}
                  </Pressable>
                ))}
              </View>
            )
          ) : null}
          {result.state === "ready" && result.data.nextPage ? <PrimaryButton label={loadingMore ? "Loading…" : "Show more"} onPress={() => more(result.data)} /> : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
