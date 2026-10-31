import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import QRCode from "react-native-qrcode-svg";

import { Avatar } from "@/components/community/Avatar";
import { GymLogo, joinAction } from "@/components/community/GymCard";
import { FormAlert } from "@/components/FormAlert";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { codeFromScan, formatCode, membershipButton, roleLabels } from "@/lib/gymRules";
import { gyms, inviteLink, type Gym, type MyInvitation } from "@/lib/gyms";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

type Tab = "link" | "qr" | "search";
const tabs: { key: Tab; label: string }[] = [
  { key: "link", label: "Invite Link" },
  { key: "qr", label: "QR Code" },
  { key: "search", label: "Search" },
];

const members = (count: number) => `${count.toLocaleString("en-IN")} ${count === 1 ? "member" : "members"}`;

// Join a Gym: Invite Link (paste a link or code; your invitations), QR Code (scan a gym's QR or
// type its code; staff share their own gym's QR) and Search (by name, area or code). Every code
// opens the Gym Invitation screen, where it's accepted.
export default function JoinGym() {
  const params = useLocalSearchParams<{ tab?: string; code?: string }>();
  const getToken = useSessionToken();
  const [tab, setTab] = useState<Tab>(params.tab === "qr" || params.tab === "search" ? params.tab : "link");
  const [error, setError] = useState<string | null>(null);

  // Invite Link
  const [link, setLink] = useState(params.code ?? "");
  const [invitations, setInvitations] = useState<MyInvitation[] | null>(null);

  // QR Code
  const [typed, setTyped] = useState("");
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const scanned = useRef(false); // the camera reports a code many times a second; act on the first
  const [staffGyms, setStaffGyms] = useState<Gym[]>([]);
  const [shareGymId, setShareGymId] = useState<string | null>(null);

  // Search
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Gym[] | null>(null);
  const [codeMatch, setCodeMatch] = useState<{ code: string; gym: Gym } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Any code or link opens the invitation screen
  const openCode = (value: string) => {
    const code = codeFromScan(value);
    if (!code) return setError("That isn't an justFit invitation link or code. Codes have 8 or 10 letters and numbers.");
    setError(null);
    router.push({ pathname: "/community/gyms/invite/[code]", params: { code } });
  };

  const loadInvitations = useCallback(async () => {
    const result = await gyms.myInvitations(await getToken());
    setInvitations(result.ok ? result.data.invitations : []);
  }, [getToken]);

  // Gyms where you're staff have a code to share
  const loadStaffGyms = useCallback(async () => {
    const result = await gyms.list(await getToken());
    if (!result.ok) return;
    const withCode = result.data.mine.filter((gym) => gym.inviteCode);
    setStaffGyms(withCode);
    setShareGymId((current) => (current && withCode.some((g) => g.id === current) ? current : withCode[0]?.id ?? null));
  }, [getToken]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => {
        loadInvitations();
        loadStaffGyms();
      }, 0);
      return () => clearTimeout(timer);
    }, [loadInvitations, loadStaffGyms]),
  );

  const runSearch = useCallback(async () => {
    const token = await getToken();
    const term = search.trim();
    const code = codeFromScan(term);
    const [list, preview] = await Promise.all([gyms.list(token, term || null), code ? gyms.previewCode(token, code) : Promise.resolve(null)]);
    if (list.ok) setResults([...list.data.mine, ...list.data.explore]);
    else setError(list.error);
    setCodeMatch(code && preview?.ok ? { code, gym: preview.data.gym } : null);
  }, [search, getToken]);

  useEffect(() => {
    if (tab !== "search") return;
    const timer = setTimeout(runSearch, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [tab, search, runSearch]);

  // A pull reads your invitations and the gyms you can share a code for again, and the
  // search results when that tab is open
  const reload = useCallback(
    () => Promise.all([loadInvitations(), loadStaffGyms(), tab === "search" ? runSearch() : undefined]),
    [loadInvitations, loadStaffGyms, runSearch, tab],
  );
  const { refreshControl } = usePullToRefresh(reload);

  const act = async (gym: Gym, action: "join" | "request" | "cancel") => {
    setBusyId(gym.id);
    const token = await getToken();
    const result = action === "cancel" ? await gyms.leave(token, gym.id) : await gyms.join(token, gym.id);
    if (result.ok) await runSearch();
    else setError(result.error);
    setBusyId(null);
  };

  const share = async (message: string) => {
    try {
      await Share.share({ message });
    } catch {
      setError("Sharing isn't available here.");
    }
  };

  // Open the scanner, asking for the camera first if needed
  const openScanner = async () => {
    setError(null);
    const granted = permission?.granted || (await requestPermission()).granted;
    if (!granted) return setError("Camera access is off. Allow it in Settings, or type the code instead.");
    scanned.current = false;
    setScanning(true);
  };

  const onScan = ({ data }: BarcodeScanningResult) => {
    if (scanned.current) return;
    scanned.current = true;
    setScanning(false);
    if (!codeFromScan(data)) return setError("That QR code isn't an justFit gym code.");
    openCode(data);
  };

  const shareGym = staffGyms.find((gym) => gym.id === shareGymId) ?? null;

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View className="screen-bar">
          <Pressable onPress={() => router.back()} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title">Join a Gym</Text>
          <View className="screen-bar__spacer" />
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }} keyboardShouldPersistTaps="handled" refreshControl={refreshControl}>
            <View className="segment" accessibilityRole="tablist">
              {tabs.map((item) => (
                <Pressable key={item.key} onPress={() => { setTab(item.key); setError(null); }} className={tab === item.key ? "segment__item segment__item--active" : "segment__item"} accessibilityRole="tab" accessibilityState={{ selected: tab === item.key }}>
                  <Text className={tab === item.key ? "segment__label segment__label--active" : "segment__label"}>{item.label}</Text>
                </Pressable>
              ))}
            </View>

            {error && (
              <Pressable onPress={() => setError(null)} accessibilityLabel="Dismiss error">
                <FormAlert message={error} />
              </Pressable>
            )}

            {tab === "link" && (
              <>
                <View className="join-card gap-3">
                  <View className="flex-row items-center gap-3">
                    <View className="compose__option-icon">
                      <SymbolView name={{ ios: "link", android: "link", web: "link" }} size={18} tintColor={colors.ink} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="join-card__title">Have an invitation link?</Text>
                      <Text className="join-card__hint">Paste it below to see the gym and accept.</Text>
                    </View>
                  </View>
                  <Text className="compose__label">Invitation link</Text>
                  <TextInput className="compose__input" value={link} onChangeText={setLink} placeholder="https://…/gyms/invite/ABCD-EFGH" placeholderTextColor={colors.faint} autoCapitalize="none" autoCorrect={false} onSubmitEditing={() => openCode(link)} accessibilityLabel="Invitation link" />
                  <Pressable onPress={() => openCode(link)} className="btn-outline" accessibilityRole="button" accessibilityLabel="Open invitation">
                    <Text className="btn-outline__label">Open invitation</Text>
                  </Pressable>
                </View>

                <Text className="compose__label mt-2">Your invitations</Text>
                {invitations === null ? (
                  <ActivityIndicator color={colors.forest} />
                ) : invitations.length === 0 ? (
                  <Text className="home__note">Invitations sent to your email show here, and on the Gyms tab.</Text>
                ) : (
                  invitations.map((invite) => (
                    <View key={invite.code} className="join-card gap-3">
                      <View className="flex-row items-center gap-3">
                        <GymLogo gym={invite.gym} size={42} />
                        <View className="min-w-0 flex-1">
                          <Text className="join-card__title" numberOfLines={1}>{invite.gym.name}</Text>
                          {invite.invitedBy && (
                            <View className="flex-row items-center gap-1.5">
                              <Avatar member={invite.invitedBy} size={16} />
                              <Text className="join-card__hint" numberOfLines={1}>Invited by {invite.invitedBy.name}</Text>
                            </View>
                          )}
                        </View>
                      </View>
                      <View className="join-card__link">
                        <Text className="join-card__link-text" numberOfLines={1}>{inviteLink(invite.code)}</Text>
                      </View>
                      <View className="flex-row items-center gap-2">
                        <Pressable onPress={() => share(`Join ${invite.gym.name} on justFit: ${inviteLink(invite.code)} (code ${formatCode(invite.code)})`)} className="gym-join flex-row gap-1.5" accessibilityRole="button" accessibilityLabel={`Share the invitation to ${invite.gym.name}`}>
                          <SymbolView name={{ ios: "square.and.arrow.up", android: "share", web: "share" }} size={15} tintColor={colors.ink} />
                          <Text className="gym-join__label">Share</Text>
                        </Pressable>
                        <View className="flex-1" />
                        <Pressable onPress={() => openCode(invite.code)} className="gym-join gym-join--filled" accessibilityRole="button" accessibilityLabel={`View the invitation to ${invite.gym.name}`}>
                          <Text className="gym-join__label gym-join__label--filled">View</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))
                )}
              </>
            )}

            {tab === "qr" && (
              <>
                <Pressable onPress={openScanner} className="join-card flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel="Scan a QR code">
                  <View className="join-card__scan">
                    <SymbolView name={{ ios: "qrcode.viewfinder", android: "qr_code_scanner", web: "qr_code_scanner" }} size={24} tintColor={colors.white} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="join-card__title">Scan a gym QR code</Text>
                    <Text className="join-card__hint">{"Find it at the front desk"}</Text>
                  </View>
                  <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={16} tintColor={colors.inkSoft} />
                </Pressable>

                <View className="join-card gap-3">
                  <Text className="compose__label">Or enter an invitation code</Text>
                  <TextInput className="compose__input" value={typed} onChangeText={(value) => setTyped(value.toUpperCase())} placeholder="e.g. ABCD-EFGH" placeholderTextColor={colors.faint} autoCapitalize="characters" autoCorrect={false} maxLength={12} onSubmitEditing={() => openCode(typed)} accessibilityLabel="Invite code" />
                  <Pressable onPress={() => openCode(typed)} className="btn-outline" accessibilityRole="button" accessibilityLabel="Continue">
                    <Text className="btn-outline__label">Continue</Text>
                  </Pressable>
                </View>

                {shareGym?.inviteCode && (
                  <>
                    <View className="mt-2 flex-row items-center gap-2">
                      <SymbolView name={{ ios: "qrcode", android: "qr_code", web: "qr_code" }} size={18} tintColor={colors.ink} />
                      <Text className="join-card__title">Invite a friend to your gym</Text>
                    </View>
                    {staffGyms.length > 1 && (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                        {staffGyms.map((gym) => (
                          <Pressable key={gym.id} onPress={() => setShareGymId(gym.id)} className={gym.id === shareGymId ? "friend-chip friend-chip--selected" : "friend-chip"} accessibilityRole="radio" accessibilityState={{ selected: gym.id === shareGymId }} accessibilityLabel={`Share ${gym.name}'s QR code`}>
                            <Text className={gym.id === shareGymId ? "friend-chip__label friend-chip__label--selected" : "friend-chip__label"}>{gym.name}</Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    )}
                    <View className="join-card items-center gap-3">
                      <View className="join-card__qr">
                        <QRCode value={inviteLink(shareGym.inviteCode)} size={170} color={colors.ink} backgroundColor={colors.white} />
                      </View>
                      <Text className="join-card__title">{shareGym.name}</Text>
                      <Text className="join-card__hint">Scan to join · Code {formatCode(shareGym.inviteCode)}</Text>
                      <Pressable onPress={() => share(`Join ${shareGym.name} on justFit: ${inviteLink(shareGym.inviteCode ?? "")} (code ${formatCode(shareGym.inviteCode ?? "")})`)} className="btn-forest w-full flex-row items-center justify-center gap-2" accessibilityRole="button" accessibilityLabel="Share QR">
                        <SymbolView name={{ ios: "square.and.arrow.up", android: "share", web: "share" }} size={16} tintColor={colors.white} />
                        <Text className="btn-forest__label">Share QR</Text>
                      </Pressable>
                    </View>
                  </>
                )}
              </>
            )}

            {tab === "search" && (
              <>
                <View className="search search--pill">
                  <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
                  <TextInput className="search__input" value={search} onChangeText={setSearch} placeholder="Gym name, area or invite code" placeholderTextColor={colors.faint} autoCorrect={false} accessibilityLabel="Search gyms or enter a code" />
                </View>
                {codeMatch && (
                  <Pressable onPress={() => openCode(codeMatch.code)} className="join-card flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel={`Code ${formatCode(codeMatch.code)} opens ${codeMatch.gym.name}`}>
                    <GymLogo gym={codeMatch.gym} size={40} />
                    <View className="min-w-0 flex-1">
                      <Text className="join-card__title" numberOfLines={1}>{codeMatch.gym.name}</Text>
                      <Text className="join-card__hint">Code {formatCode(codeMatch.code)} · tap to review</Text>
                    </View>
                    <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={16} tintColor={colors.inkSoft} />
                  </Pressable>
                )}
                {results === null ? (
                  <ActivityIndicator color={colors.forest} />
                ) : results.length === 0 ? (
                  <Text className="home__note">No gyms match. Try another name or area, or an invite code.</Text>
                ) : (
                  <View>
                    {results.map((gym, index) => {
                      const action = joinAction(gym);
                      const button = membershipButton(gym.membership, gym.joinMode);
                      const edge = [index === 0 ? "friend-row--first" : "", index === results.length - 1 ? "friend-row--last" : ""].join(" ");
                      return (
                        <View key={gym.id} className={`friend-row ${edge}`}>
                          <Pressable onPress={() => router.push({ pathname: "/community/gyms/[id]", params: { id: gym.id } })} className="min-w-0 flex-1 flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel={`Open ${gym.name}`}>
                            <GymLogo gym={gym} size={42} />
                            <View className="min-w-0 flex-1">
                              <Text className="friend-row__name" numberOfLines={1}>{gym.name}</Text>
                              <Text className="friend-row__note" numberOfLines={2}>{[gym.location, members(gym.memberCount)].filter(Boolean).join(" · ")}</Text>
                            </View>
                          </Pressable>
                          {gym.membership?.status === "active" ? (
                            <View className={gym.membership.role === "member" ? "gym-badge gym-badge--member" : "gym-badge gym-badge--staff"}>
                              <Text className={gym.membership.role === "member" ? "gym-badge__label" : "gym-badge__label gym-badge__label--staff"}>{roleLabels[gym.membership.role]}</Text>
                            </View>
                          ) : action ? (
                            <Pressable onPress={() => act(gym, action)} disabled={busyId === gym.id} className={action === "join" ? "gym-join gym-join--filled" : "gym-join"} style={{ opacity: busyId === gym.id ? 0.5 : 1 }} accessibilityRole="button" accessibilityLabel={action === "cancel" ? `Cancel your request to join ${gym.name}` : `${button.label}: ${gym.name}`}>
                              <Text className={action === "join" ? "gym-join__label gym-join__label--filled" : "gym-join__label"}>{action === "cancel" ? "Cancel" : button.label}</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                )}
                <View className="flex-row items-center gap-1.5">
                  <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={12} tintColor={colors.faint} />
                  <Text className="home__note">Tip: search a name or area, or type an invite code like ABCD-EFGH.</Text>
                </View>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <View style={{ flex: 1, backgroundColor: colors.black }}>
          <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={scanning ? onScan : undefined} />
          <SafeAreaView edges={["bottom"]} style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 20, gap: 12 }}>
            <Text style={{ color: colors.white, textAlign: "center", fontSize: 15 }}>{"Point the camera at the gym's QR code"}</Text>
            <Pressable onPress={() => setScanning(false)} className="btn-outline" accessibilityRole="button" accessibilityLabel="Close the scanner">
              <Text className="btn-outline__label">Cancel</Text>
            </Pressable>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}
