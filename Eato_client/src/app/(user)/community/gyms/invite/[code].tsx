import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useLocalSearchParams } from "expo-router";

import { AuthImage } from "@/components/community/AuthImage";
import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { GymLogo } from "@/components/community/GymCard";
import { FormAlert } from "@/components/FormAlert";
import type { Member } from "@/lib/community";
import { codeFromScan } from "@/lib/gymRules";
import { gyms, type Gym } from "@/lib/gyms";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

type Preview = { gym: Gym; role: "member" | "trainer"; invitedBy: Member | null };

// Gym Invitation: what a code or link opens, before accepting. Works for hidden gyms too (the
// code is the invitation). Accepting joins at once (no approval) with the code's role; a gym's
// own code joins as a member. Opened from a link (justfit://community/gyms/invite/CODE, or an older eato:// one), a banner,
// the join screen or a scan.
export default function GymInvitation() {
  const params = useLocalSearchParams<{ code: string }>();
  const code = codeFromScan(params.code ?? "");
  const getToken = useSessionToken();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(code ? null : "That invitation link isn't valid.");
  const [joining, setJoining] = useState(false);

  const load = useCallback(async () => {
    if (!code) return;
    const result = await gyms.previewCode(await getToken(), code);
    if (result.ok) {
      setPreview(result.data);
      setError(null);
    } else setError(result.error);
  }, [code, getToken]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const accept = async () => {
    if (!code || joining) return;
    setJoining(true);
    const result = await gyms.joinByCode(await getToken(), code);
    setJoining(false);
    if (!result.ok) return setError(result.error);
    router.replace({ pathname: "/community/gyms/[id]", params: { id: result.data.gym.id } });
  };

  const gym = preview?.gym ?? null;
  const already = gym?.membership?.status === "active";
  const openGym = () => gym && router.replace({ pathname: "/community/gyms/[id]", params: { id: gym.id } });
  const members = gym ? `${gym.memberCount.toLocaleString("en-IN")} ${gym.memberCount === 1 ? "member" : "members"}` : "";

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={() => router.back()} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title">Gym Invitation</Text>
          <View className="screen-bar__spacer" />
        </View>

        {!gym ? (
          <View className="px-5 pt-6">
            {error ? (
              <EmptyState icon={{ ios: "envelope.badge", android: "mark_email_unread", web: "mark_email_unread" }} title="This invitation can't be opened" text={error} actionLabel="Back" onAction={() => router.back()} />
            ) : (
              <ActivityIndicator color={colors.forest} />
            )}
          </View>
        ) : (
          <>
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
              {gym.coverUrl ? (
                <AuthImage path={gym.coverUrl} style={{ width: "100%", height: 170 }} accessibilityLabel={`${gym.name} cover photo`} />
              ) : (
                <View className="gym-cover" style={{ height: 170 }} />
              )}
              <View className="invite-card mx-5">
                <View className="invite-card__logo">
                  <GymLogo gym={gym} size={68} />
                </View>
                {preview?.invitedBy ? (
                  <View className="mt-3 flex-row items-center justify-center gap-2">
                    <Avatar member={preview.invitedBy} size={22} />
                    <Text className="invite-card__from">{preview.invitedBy.name} invited you to join{preview.role === "trainer" ? " as a trainer" : ""}</Text>
                  </View>
                ) : (
                  <Text className="invite-card__from mt-3 text-center">{"You've been invited to join"}</Text>
                )}
                <Text className="invite-card__name">{gym.name}</Text>
                {gym.tagline && <Text className="invite-card__tagline">{gym.tagline}</Text>}
                <View className="mt-3 flex-row flex-wrap items-center justify-center gap-4">
                  {gym.location && (
                    <View className="flex-row items-center gap-1">
                      <SymbolView name={{ ios: "mappin.and.ellipse", android: "place", web: "place" }} size={14} tintColor={colors.inkSoft} />
                      <Text className="gym-card__members">{gym.location}</Text>
                    </View>
                  )}
                  <View className="flex-row items-center gap-1">
                    <SymbolView name={{ ios: "person.2", android: "group", web: "group" }} size={14} tintColor={colors.inkSoft} />
                    <Text className="gym-card__members">{members}</Text>
                  </View>
                </View>
              </View>
              {gym.description && <Text className="post__body mx-5 mt-5">{gym.description}</Text>}
              {gym.facilities.length > 0 && (
                <View className="mx-5 mt-4 flex-row flex-wrap gap-2">
                  {gym.facilities.map((facility) => (
                    <View key={facility} className="friend-chip">
                      <Text className="friend-chip__label">{facility}</Text>
                    </View>
                  ))}
                </View>
              )}
              {already && <Text className="home__note mx-5 mt-5">{`You're already a member of ${gym.name}.`}</Text>}
              {error && (
                <View className="mx-5 mt-4">
                  <FormAlert message={error} />
                </View>
              )}
            </ScrollView>
            <View className="compose__footer">
              {already ? (
                <Pressable onPress={openGym} className="btn-forest flex-1" accessibilityRole="button" accessibilityLabel="Open gym">
                  <Text className="btn-forest__label">Open gym</Text>
                </Pressable>
              ) : (
                <>
                  <Pressable onPress={() => router.back()} disabled={joining} className="btn-outline flex-1" accessibilityRole="button" accessibilityLabel="Decline">
                    <Text className="btn-outline__label">Decline</Text>
                  </Pressable>
                  <Pressable onPress={accept} disabled={joining} className="btn-forest flex-1" style={{ opacity: joining ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Accept invitation">
                    {joining ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">Accept Invitation</Text>}
                  </Pressable>
                </>
              )}
            </View>
          </>
        )}
      </SafeAreaView>
    </View>
  );
}
