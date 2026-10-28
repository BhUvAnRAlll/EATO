import { useCallback, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import * as Linking from "expo-linking";
import QRCode from "react-native-qrcode-svg";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { EmptyState } from "@/components/community/CommunityStates";
import { GymLogo } from "@/components/community/GymCard";
import { timeAgo } from "@/lib/community";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { FormAlert } from "@/components/FormAlert";
import { formatCode, inviteMessage, roleLabels } from "@/lib/gymRules";
import { gyms, type Gym, type Invitation } from "@/lib/gyms";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";
import { fonts } from "@/constants/fonts";

type Channel = "email" | "phone";
type Tab = "link" | "qr" | "contact";
const tabs: { key: Tab; label: string }[] = [
  { key: "link", label: "Link" },
  { key: "qr", label: "QR Code" },
  { key: "contact", label: "Phone/Email" },
];

const channelIcons = {
  email: { ios: "envelope", android: "mail", web: "mail" },
  phone: { ios: "phone", android: "call", web: "call" },
  qr: { ios: "qrcode", android: "qr_code", web: "qr_code" },
  link: { ios: "link", android: "link", web: "link" },
} as const;

const statusLabels: Record<Invitation["status"], string> = { pending: "Pending", accepted: "Accepted", revoked: "Revoked", expired: "Expired" };

// Invite people (gym staff): share the gym's code or a one-off invitation link, or record an
// invitation for an email or phone number. JustFit sends nothing itself: sharing uses the phone's
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
  const [tab, setTab] = useState<Tab>("link");

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
        <View className="screen-bar">
          <Pressable onPress={() => router.back()} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <View className="flex-1 items-center">
            <Text className="screen-bar__title">Invite Members</Text>
            {gym && <Text className="gym-card__meta" numberOfLines={1}>{gym.name}</Text>}
          </View>
          <View className="screen-bar__spacer" />
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <View className="segment" accessibilityRole="tablist">
              {tabs.map((item) => (
                <Pressable key={item.key} onPress={() => setTab(item.key)} className={tab === item.key ? "segment__item segment__item--active" : "segment__item"} accessibilityRole="tab" accessibilityState={{ selected: tab === item.key }}>
                  <Text className={tab === item.key ? "segment__label segment__label--active" : "segment__label"}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
            {error && <Pressable onPress={() => setError(null)}><FormAlert message={error} /></Pressable>}
            {notice && (
              <Pressable onPress={() => setNotice(null)} className="info-banner">
                <SymbolView name={{ ios: "checkmark.circle", android: "check_circle", web: "check_circle" }} size={16} tintColor={colors.inkSoft} />
                <Text className="info-banner__text">{notice}</Text>
              </Pressable>
            )}

            {tab === "link" && gym?.inviteCode && (
              <View className="join-card gap-3">
                <View className="flex-row items-center gap-3">
                  <GymLogo gym={gym} size={40} />
                  <View className="min-w-0 flex-1">
                    <Text className="join-card__title" numberOfLines={1}>{gym.name}</Text>
                    <Text className="join-card__hint">Invited people skip the approval queue</Text>
                  </View>
                </View>
                <View className="join-card__link">
                  <Text className="join-card__link-text" numberOfLines={1} selectable>{linkFor(gym.inviteCode)}</Text>
                </View>
                <Text className="join-card__hint" accessibilityLabel={`Gym code ${gym.inviteCode.split("").join(" ")}`}>Invite code <Text className="join-card__link-text" style={{ fontFamily: fonts.semibold }}>{formatCode(gym.inviteCode)}</Text></Text>
                <Pressable onPress={() => share(gym.inviteCode ?? "")} className="btn-forest flex-row items-center justify-center gap-2" accessibilityRole="button" accessibilityLabel="Share gym code">
                  <SymbolView name={{ ios: "square.and.arrow.up", android: "share", web: "share" }} size={16} tintColor={colors.white} />
                  <Text className="btn-forest__label">Share Link</Text>
                </Pressable>
                <View className="mt-1 gap-2">
                  <Text className="compose__label">Or a one-off link{canInviteTrainers ? " with a role" : ""}</Text>
                  {canInviteTrainers && (
                    <View className="flex-row gap-2" accessibilityRole="radiogroup">
                      {(["member", "trainer"] as const).map((option) => (
                        <Pressable key={option} onPress={() => setRole(option)} className={role === option ? "friend-chip friend-chip--selected" : "friend-chip"} accessibilityRole="radio" accessibilityState={{ selected: role === option }} accessibilityLabel={`Invite as ${roleLabels[option]}`}>
                          <Text className={role === option ? "friend-chip__label friend-chip__label--selected" : "friend-chip__label"}>As {roleLabels[option].toLowerCase()}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                  <Pressable onPress={shareNewLink} disabled={busy === "link"} className="btn-outline" style={{ opacity: busy === "link" ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Share a one-off invitation link">
                    {busy === "link" ? <ActivityIndicator color={colors.forest} /> : <Text className="btn-outline__label">Share a one-off link</Text>}
                  </Pressable>
                </View>
                {gym.can.manage && (
                  <Pressable onPress={() => setConfirmingRotate(true)} className="self-center" accessibilityRole="button" accessibilityLabel="Replace the gym code">
                    <Text className="home__note" style={{ color: colors.danger }}>Code leaked? Replace it</Text>
                  </Pressable>
                )}
              </View>
            )}

            {tab === "qr" && gym?.inviteCode && (
              <View className="join-card items-center gap-3">
                {/* The QR holds the invite link: scanning it in JustFit (Join a Gym › QR Code) or with the phone's camera opens the invitation */}
                <View className="join-card__qr" accessibilityLabel={`QR code for ${gym.name}'s invite link`}>
                  <QRCode value={linkFor(gym.inviteCode)} size={190} color={colors.ink} backgroundColor={colors.white} />
                </View>
                <Text className="join-card__title">{gym.name}</Text>
                <Text className="join-card__hint">Scan to join · Code {formatCode(gym.inviteCode)}</Text>
                <Pressable onPress={() => share(gym.inviteCode ?? "")} className="btn-forest w-full flex-row items-center justify-center gap-2" accessibilityRole="button" accessibilityLabel="Share QR">
                  <SymbolView name={{ ios: "square.and.arrow.up", android: "share", web: "share" }} size={16} tintColor={colors.white} />
                  <Text className="btn-forest__label">Share QR</Text>
                </Pressable>
                <Text className="home__note text-center">Print it by the front desk. Anyone who scans it joins as a member, without approval.</Text>
              </View>
            )}

            {tab === "contact" && (
              <View className="join-card gap-3">
                {canInviteTrainers && (
                  <View className="flex-row gap-2" accessibilityRole="radiogroup">
                    {(["member", "trainer"] as const).map((option) => (
                      <Pressable key={option} onPress={() => setRole(option)} className={role === option ? "friend-chip friend-chip--selected" : "friend-chip"} accessibilityRole="radio" accessibilityState={{ selected: role === option }} accessibilityLabel={`Invite as ${roleLabels[option]}`}>
                        <Text className={role === option ? "friend-chip__label friend-chip__label--selected" : "friend-chip__label"}>As {roleLabels[option].toLowerCase()}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
                <View className="flex-row gap-2" accessibilityRole="radiogroup">
                  {(["email", "phone"] as const).map((option) => (
                    <Pressable key={option} onPress={() => setChannel(option)} className={channel === option ? "friend-chip friend-chip--selected" : "friend-chip"} accessibilityRole="radio" accessibilityState={{ selected: channel === option }}>
                      <Text className={channel === option ? "friend-chip__label friend-chip__label--selected" : "friend-chip__label"}>{option === "email" ? "Email" : "Phone"}</Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  className="compose__input"
                  value={contact}
                  onChangeText={setContact}
                  placeholder={channel === "email" ? "name@example.com" : "+91 98765 43210"}
                  placeholderTextColor={colors.faint}
                  keyboardType={channel === "email" ? "email-address" : "phone-pad"}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel={channel === "email" ? "Email to invite" : "Phone number to invite"}
                />
                <Pressable onPress={record} disabled={busy === "record" || !contact.trim()} className="btn-forest" style={{ opacity: busy === "record" || !contact.trim() ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Record invitation">
                  {busy === "record" ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">Record invitation</Text>}
                </Pressable>
                <Text className="home__note">No SMS or email is sent. Email invitations also show to that person in JustFit; for a phone number, pass the code on yourself.</Text>
              </View>
            )}

            <Text className="gym-about__title mt-1">Invitation status</Text>
            {invitations === null ? (
              <ActivityIndicator color={colors.forest} />
            ) : invitations.length === 0 ? (
              <EmptyState icon={{ ios: "envelope.open", android: "drafts", web: "drafts" }} title="No invitations yet" text="Links and invitations you create show here." />
            ) : (
              <View>
                {invitations.map((item, index) => {
                  const edge = [index === 0 ? "friend-row--first" : "", index === invitations.length - 1 ? "friend-row--last" : ""].join(" ");
                  const icon = channelIcons[item.channel];
                  return (
                    <View key={item.id} className={`about-row ${edge}`}>
                      <View className="compose__option-icon">
                        <SymbolView name={icon} size={17} tintColor={colors.ink} />
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className="join-card__title" numberOfLines={1}>{item.contact ?? (item.channel === "qr" ? "QR invitation" : "Invitation link")}</Text>
                        <Text className="join-card__hint" numberOfLines={1}>{`${roleLabels[item.role]} · ${timeAgo(item.createdAt)} · ${formatCode(item.code)}`}</Text>
                        <View className="mt-1 flex-row gap-4">
                          {item.status === "pending" && (
                            <Pressable onPress={() => share(item.code)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Share invitation ${item.code}`}>
                              <Text className="gym-section__link" style={{ fontSize: 13 }}>Share</Text>
                            </Pressable>
                          )}
                          {item.status === "pending" && (
                            <Pressable onPress={() => change(item, "revoke")} disabled={busy === item.id} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Revoke invitation ${item.code}`}>
                              <Text className="gym-section__link" style={{ fontSize: 13, color: colors.danger }}>Revoke</Text>
                            </Pressable>
                          )}
                          {item.status === "expired" && gym?.can.manage && (
                            <Pressable onPress={() => change(item, "renew")} disabled={busy === item.id} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Renew invitation ${item.code}`}>
                              <Text className="gym-section__link" style={{ fontSize: 13 }}>Renew</Text>
                            </Pressable>
                          )}
                        </View>
                      </View>
                      <View className={item.status === "pending" ? "gym-pending" : item.status === "accepted" ? "gym-badge gym-badge--member" : "gym-badge"}>
                        <Text className={item.status === "pending" ? "gym-pending__label" : "gym-badge__label"}>{statusLabels[item.status]}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
      <ConfirmSheet visible={confirmingRotate} title="Replace the gym code?" text="Anyone holding the old code can no longer join with it. Invitation links keep working." confirmLabel="Replace code" busy={busy === "rotate"} onConfirm={rotate} onCancel={() => setConfirmingRotate(false)} />
    </View>
  );
}
