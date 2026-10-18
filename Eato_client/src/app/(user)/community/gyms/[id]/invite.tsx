import { useCallback, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import * as Linking from "expo-linking";
import QRCode from "react-native-qrcode-svg";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { EmptyState } from "@/components/community/CommunityStates";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { FormAlert } from "@/components/FormAlert";
import { formatCode, inviteMessage, roleLabels } from "@/lib/gymRules";
import { gyms, type Gym, type Invitation } from "@/lib/gyms";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

type Channel = "email" | "phone";

const statusLabels: Record<Invitation["status"], string> = { pending: "Pending", accepted: "Accepted", revoked: "Revoked", expired: "Expired" };

// Invite people (gym staff): share the gym's code or a one-off invitation link, or record an
// invitation for an email or phone number. EATO sends nothing itself: sharing uses the phone's
// share sheet, and recorded invitations are only a list for staff. Admins can invite trainers.
export default function InviteToGym() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const getToken = useSessionToken();
  const [gym, setGym] = useState<Gym | null>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [channel, setChannel] = useState<Channel>("email");
  const [contact, setContact] = useState("");
  const [role, setRole] = useState<Invitation["role"]>("member");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingRotate, setConfirmingRotate] = useState(false);

  const load = useCallback(async () => {
    const token = await getToken();
    const [gymResult, list] = await Promise.all([gyms.get(token, id), gyms.invitations(token, id)]);
    if (gymResult.ok) setGym(gymResult.data.gym);
    else setError(gymResult.error);
    if (list.ok) setInvitations(list.data.invitations);
    else setError(list.error);
  }, [id, getToken]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const linkFor = (code: string) => Linking.createURL(`/community/gyms/invite/${code}`);

  const share = async (code: string) => {
    if (!gym) return;
    try {
      await Share.share({ message: inviteMessage(gym.name, code, linkFor(code)) });
    } catch {
      setNotice(`Share this code: ${formatCode(code)}`);
    }
  };

  // A one-off link with a role (trainer invitations need an admin), shared straight away
  const shareNewLink = async () => {
    setBusy("link");
    const result = await gyms.createInvitation(await getToken(), id, { channel: "link", role });
    setBusy(null);
    if (!result.ok) return setError(result.error);
    await load();
    await share(result.data.invitation.code);
  };

  const record = async () => {
    setBusy("record");
    setError(null);
    const result = await gyms.createInvitation(await getToken(), id, { channel, contact: contact.trim(), role });
    setBusy(null);
    if (!result.ok) return setError(result.error);
    setContact("");
    setNotice(`Invitation recorded for ${result.data.invitation.contact}. Nothing was sent: share code ${formatCode(result.data.invitation.code)} with them yourself.`);
    await load();
  };

  const change = async (invitation: Invitation, action: "revoke" | "renew") => {
    setBusy(invitation.id);
    const result = await gyms.changeInvitation(await getToken(), id, invitation.id, action);
    setBusy(null);
    if (!result.ok) return setError(result.error);
    await load();
  };

  // A leaked gym code is replaced; the old one stops working at once
  const rotate = async () => {
    if (!gym) return;
    setBusy("rotate");
    const result = await gyms.rotateCode(await getToken(), gym.id);
    setBusy(null);
    setConfirmingRotate(false);
    if (!result.ok) return setError(result.error);
    setGym(result.data.gym);
    setNotice("The gym code was replaced. The old code no longer works.");
  };

  const canInviteTrainers = gym?.can.manage ?? false;

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View className="h-12 flex-row items-center px-5">
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
          </Pressable>
          <Text className="type-subhead ml-3 flex-1 text-forest-ink" numberOfLines={1}>Invite to {gym?.name ?? "the gym"}</Text>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            {error && <Pressable onPress={() => setError(null)}><FormAlert message={error} /></Pressable>}
            {notice && (
              <Pressable onPress={() => setNotice(null)} className="setup__info">
                <SymbolView name={{ ios: "checkmark.circle", android: "check_circle", web: "check_circle" }} size={18} tintColor={colors.forest} />
                <Text className="setup__card-text flex-1">{notice}</Text>
              </Pressable>
            )}

            {gym?.inviteCode && (
              <View className="post__card items-center gap-2">
                <Text className="setup__section">Gym code</Text>
                {/* The QR holds the invite link: scanning it in EATO (Join a gym → Scan) or with the phone's camera opens the join screen */}
                <View className="my-2 rounded-lg bg-white p-3" accessibilityLabel={`QR code for ${gym.name}'s invite link`}>
                  <QRCode value={linkFor(gym.inviteCode)} size={180} color={colors.forestInk} backgroundColor={colors.white} />
                </View>
                <Text selectable className="type-display text-forest-ink" style={{ letterSpacing: 4 }} accessibilityLabel={`Gym code ${gym.inviteCode.split("").join(" ")}`}>{formatCode(gym.inviteCode)}</Text>
                <Text className="home__note text-center">Anyone with this code joins as a member, without approval. Print it by the front desk or share it.</Text>
                <Pressable onPress={() => share(gym.inviteCode ?? "")} className="btn-forest mt-1 w-full" accessibilityRole="button" accessibilityLabel="Share gym code">
                  <Text className="btn-forest__label">Share code</Text>
                </Pressable>
                <Text className="home__note text-center">Members scan this QR code in Community → Gyms → Join, or type the code under it.</Text>
                {gym.can.manage && (
                  <Pressable onPress={() => setConfirmingRotate(true)} className="mt-1" accessibilityRole="button" accessibilityLabel="Replace the gym code">
                    <Text className="home__note" style={{ color: colors.danger }}>Code leaked? Replace it</Text>
                  </Pressable>
                )}
              </View>
            )}

            <View className="post__card gap-3">
              <Text className="setup__section">Invitation</Text>
              {canInviteTrainers && (
                <View className="flex-row gap-2" accessibilityRole="radiogroup">
                  {(["member", "trainer"] as const).map((option) => (
                    <Pressable key={option} onPress={() => setRole(option)} className={role === option ? "setup__chip setup__chip--selected" : "setup__chip"} accessibilityRole="radio" accessibilityState={{ selected: role === option }} accessibilityLabel={`Invite as ${roleLabels[option]}`}>
                      <Text className={role === option ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>As {roleLabels[option].toLowerCase()}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <Pressable onPress={shareNewLink} disabled={busy === "link"} className="btn-outline" style={{ opacity: busy === "link" ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Share a one-off invitation link">
                {busy === "link" ? <ActivityIndicator color={colors.forest} /> : <Text className="btn-outline__label">Share a one-off link</Text>}
              </Pressable>
              <View className="flex-row gap-2" accessibilityRole="radiogroup">
                {(["email", "phone"] as const).map((option) => (
                  <Pressable key={option} onPress={() => setChannel(option)} className={channel === option ? "setup__chip setup__chip--selected" : "setup__chip"} accessibilityRole="radio" accessibilityState={{ selected: channel === option }}>
                    <Text className={channel === option ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{option === "email" ? "Email" : "Phone"}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={contact}
                onChangeText={setContact}
                placeholder={channel === "email" ? "name@example.com" : "+91 98765 43210"}
                placeholderTextColor={colors.faint}
                keyboardType={channel === "email" ? "email-address" : "phone-pad"}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel={channel === "email" ? "Email to invite" : "Phone number to invite"}
                style={{ height: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.creamLine, backgroundColor: colors.white, paddingHorizontal: 14, fontSize: 15, color: colors.forestInk }}
              />
              <Pressable onPress={record} disabled={busy === "record" || !contact.trim()} className="btn-forest" style={{ opacity: busy === "record" || !contact.trim() ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Record invitation">
                {busy === "record" ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">Record invitation</Text>}
              </Pressable>
              <Text className="home__note">No SMS or email is sent. The invitation is recorded here with its own code for you to pass on.</Text>
            </View>

            <Text className="setup__section">Invitations</Text>
            {invitations === null ? (
              <ActivityIndicator color={colors.forest} />
            ) : invitations.length === 0 ? (
              <EmptyState icon={{ ios: "envelope.open", android: "drafts", web: "drafts" }} title="No invitations yet" text="Links and invitations you create show here." />
            ) : (
              invitations.map((item) => (
                <View key={item.id} className="post__card gap-1">
                  <View className="flex-row items-center justify-between">
                    <Text className="post__author">{item.contact ?? (item.channel === "qr" ? "QR invitation" : "Invitation link")}</Text>
                    <Text className="post__time" style={{ color: item.status === "pending" ? colors.leaf : colors.muted }}>{statusLabels[item.status]}</Text>
                  </View>
                  <Text className="post__time">{`${roleLabels[item.role]} · code ${formatCode(item.code)}${item.invitedBy ? ` · by ${item.invitedBy.name.split(" ")[0]}` : ""}`}</Text>
                  <View className="mt-2 flex-row gap-2">
                    {item.status === "pending" && (
                      <Pressable onPress={() => share(item.code)} className="admin__action" accessibilityRole="button" accessibilityLabel={`Share invitation ${item.code}`}>
                        <Text className="admin__action-label">Share</Text>
                      </Pressable>
                    )}
                    {item.status === "pending" && (
                      <Pressable onPress={() => change(item, "revoke")} disabled={busy === item.id} className="admin__action" accessibilityRole="button" accessibilityLabel={`Revoke invitation ${item.code}`}>
                        <Text className="admin__action-label" style={{ color: colors.danger }}>Revoke</Text>
                      </Pressable>
                    )}
                    {item.status === "expired" && gym?.can.manage && (
                      <Pressable onPress={() => change(item, "renew")} disabled={busy === item.id} className="admin__action" accessibilityRole="button" accessibilityLabel={`Renew invitation ${item.code}`}>
                        <Text className="admin__action-label">Renew</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
      <ConfirmSheet visible={confirmingRotate} title="Replace the gym code?" text="Anyone holding the old code can no longer join with it. Invitation links keep working." confirmLabel="Replace code" busy={busy === "rotate"} onConfirm={rotate} onCancel={() => setConfirmingRotate(false)} />
    </View>
  );
}
