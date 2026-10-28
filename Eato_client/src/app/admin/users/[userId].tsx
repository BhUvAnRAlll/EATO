import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { Avatar } from "@/components/community/Avatar";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { KIND_LABEL, adminPortal, type AdminUser } from "@/lib/adminPortal";
import { adminModeration } from "@/lib/community";
import { useSessionToken } from "@/lib/session";
import type { Icon } from "@/types/profile";
import { colors, switchColors } from "@/theme";

// Super Admin › a user's page: their posts and reports, their gyms, and for a trainer the
// profile and the Verified switch. Suspending hides their posts from everyone else and drops a
// trainer out of search; Reinstate undoes it. Every change is written to the audit log.

const ROLE_LABEL = { owner: "Owner", admin: "Admin", trainer: "Trainer", member: "Member" } as const;
const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/users"));
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("");

export default function AdminUserDetail() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const getToken = useSessionToken();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const result = await adminPortal.user(await getToken().catch(() => null), userId);
    if (result.ok) {
      setUser(result.data.user);
      setError(null);
    } else setError(result.error);
  }, [getToken, userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const setVerified = async (verified: boolean) => {
    if (!user?.trainer || busy) return;
    setBusy(true);
    setActionError(null);
    const result = await adminPortal.setVerified(await getToken().catch(() => null), user.id, verified);
    setBusy(false);
    if (!result.ok) return setActionError(result.error);
    setUser({ ...user, trainer: { ...user.trainer, verified } });
  };

  const setSuspended = async (suspended: boolean) => {
    if (!user || busy) return;
    setBusy(true);
    setActionError(null);
    const result = await adminModeration.setSuspended(await getToken().catch(() => null), user.id, suspended);
    setBusy(false);
    setConfirming(false);
    if (!result.ok) return setActionError(result.error);
    setUser({ ...user, suspended });
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={back} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <View className="flex-1 items-center">
            <Text className="screen-bar__title" numberOfLines={1}>{user?.name ?? "Account"}</Text>
            {user && <Text className="gym-card__meta">{KIND_LABEL[user.kind]}</Text>}
          </View>
          <View className="screen-bar__back" />
        </View>

        {!user ? (
          <View className="px-5 pt-6">
            {error ? (
              <DashedBlock icon={{ ios: "person.slash", android: "person_off", web: "person_off" }} title="Can't open this account" text={`${error.replace(/\.$/, "")}. Tap to try again.`} onPress={load} />
            ) : (
              <View className="items-center py-16"><ActivityIndicator color={colors.forest} /></View>
            )}
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            <View className="admin-list flex-row items-center gap-3" style={{ padding: 16 }}>
              <Avatar member={{ id: user.id, name: user.name, initial: user.name.charAt(0).toUpperCase() }} size={64} />
              <View className="min-w-0 flex-1 gap-1.5">
                <Text className="type-subhead text-forest-ink" numberOfLines={1}>{user.name}</Text>
                <View className="flex-row flex-wrap gap-1.5">
                  <Pill label={KIND_LABEL[user.kind]} tone="ink" />
                  {user.trainer?.verified && <Pill label="Verified" tone="success" />}
                  {user.suspended && <Pill label="Suspended" tone="danger" />}
                </View>
              </View>
            </View>

            <View className="flex-row" style={{ gap: 10 }}>
              {(
                [
                  ["Posts", user.counts.posts, { ios: "photo", android: "image", web: "image" }],
                  ["Reported", user.counts.reported, { ios: "flag", android: "flag", web: "flag" }],
                  ["Removed", user.counts.removed, { ios: "nosign", android: "block", web: "block" }],
                ] as [string, number, Icon][]
              ).map(([label, value, icon]) => (
                <View key={label} className="admin-stat" accessibilityLabel={`${label}: ${value}`}>
                  <SymbolView name={icon} size={18} tintColor={colors.forestInk} />
                  <Text className="admin-stat__label">{label}</Text>
                  <Text className="admin-stat__value">{value}</Text>
                </View>
              ))}
            </View>

            {actionError && <FormAlert message={actionError} />}

            {user.trainer && (
              <>
                <Text className="type-overline text-muted">Trainer profile</Text>
                <View className="admin-list gap-1.5" style={{ padding: 16 }}>
                  <Text className="card__title">{user.trainer.title}</Text>
                  <Text className="post__time">
                    {`${user.trainer.yearsExperience} years · ${user.trainer.activeClients} active ${user.trainer.activeClients === 1 ? "client" : "clients"} · ${user.trainer.acceptingClients ? "accepting clients" : "not taking clients"}`}
                  </Text>
                  <Text className="type-body text-forest-ink mt-1">{user.trainer.qualifications.length > 0 ? "Qualifications to check:" : "No qualifications listed."}</Text>
                  {user.trainer.qualifications.map((q) => (
                    <Text key={q} className="type-body text-forest-ink">{q}</Text>
                  ))}
                </View>
                <View className="admin-list flex-row items-center gap-3" style={{ padding: 16 }}>
                  <View className="min-w-0 flex-1">
                    <Text className="card__title">Verified trainer</Text>
                    <Text className="post__time">Shows the verified badge on their public profile.</Text>
                  </View>
                  <Switch {...switchColors} value={user.trainer.verified} onValueChange={setVerified} disabled={busy} accessibilityLabel="Verified trainer" />
                </View>
                <OutlineButton label="Public trainer profile" icon={{ ios: "arrow.up.right.square", android: "open_in_new", web: "open_in_new" }} onPress={() => router.push({ pathname: "/community/trainers/[id]", params: { id: user.id } })} />
              </>
            )}

            {user.gyms.length > 0 && (
              <>
                <Text className="type-overline text-muted">Gyms</Text>
                <View className="admin-list">
                  {user.gyms.map((g, i) => (
                    <Pressable
                      key={g.id}
                      onPress={() => router.push({ pathname: "/community/gyms/[id]", params: { id: g.id } })}
                      className={i === 0 ? "admin-row" : "admin-row admin-row--divided"}
                      accessibilityRole="button"
                      accessibilityLabel={`${g.name}, ${ROLE_LABEL[g.role]}`}
                    >
                      <View className="admin-gym-badge"><Text className="admin-gym-badge__label">{initials(g.name)}</Text></View>
                      <Text className="card__title min-w-0 flex-1" numberOfLines={1}>{g.name}</Text>
                      <Pill label={ROLE_LABEL[g.role]} tone="soft" />
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            <OutlineButton label="Public profile" icon={{ ios: "arrow.up.right.square", android: "open_in_new", web: "open_in_new" }} onPress={() => router.push({ pathname: "/community/profile/[userId]", params: { userId: user.id } })} />

            {user.kind !== "admin" &&
              (user.suspended ? (
                <Pressable onPress={() => setSuspended(false)} disabled={busy} className="btn-forest" style={{ opacity: busy ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Reinstate account">
                  <Text className="btn-forest__label">Reinstate account</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => setConfirming(true)} disabled={busy} className="admin-danger-button" accessibilityRole="button" accessibilityLabel="Suspend account">
                  <SymbolView name={{ ios: "nosign", android: "block", web: "block" }} size={16} tintColor={colors.ink} />
                  <Text className="admin-danger-button__label">Suspend account</Text>
                </Pressable>
              ))}
          </ScrollView>
        )}
      </SafeAreaView>
      <ConfirmSheet
        visible={confirming}
        title={`Suspend ${user?.name ?? "this account"}?`}
        text="Their posts disappear from everyone else's feeds, and a trainer drops out of search. You can reinstate them at any time."
        confirmLabel="Suspend"
        busy={busy}
        onConfirm={() => setSuspended(true)}
        onCancel={() => setConfirming(false)}
      />
    </View>
  );
}

function Pill({ label, tone }: { label: string; tone: "ink" | "success" | "danger" | "soft" }) {
  const style = {
    ink: { backgroundColor: colors.ink, color: colors.white },
    success: { backgroundColor: colors.successSoft, color: colors.success },
    danger: { backgroundColor: colors.dangerSoft, color: colors.ink },
    soft: { backgroundColor: colors.creamTab, color: colors.forestInk },
  }[tone];
  return (
    <View className="workout__pill" style={{ backgroundColor: style.backgroundColor }}>
      <Text className="workout__pill-label" style={{ color: style.color }}>{label}</Text>
    </View>
  );
}

function OutlineButton({ label, icon, onPress }: { label: string; icon: Icon; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="btn-outline flex-row items-center justify-center gap-2" accessibilityRole="button" accessibilityLabel={label}>
      <SymbolView name={icon} size={15} tintColor={colors.forestInk} />
      <Text className="btn-outline__label">{label}</Text>
    </Pressable>
  );
}
