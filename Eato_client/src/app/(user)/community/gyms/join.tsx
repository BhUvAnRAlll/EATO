import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router, useLocalSearchParams } from "expo-router";

import { AuthImage } from "@/components/community/AuthImage";
import { FormAlert } from "@/components/FormAlert";
import { formatCode, roleLabels } from "@/lib/gymRules";
import { gyms, type Gym } from "@/lib/gyms";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

// Join a gym with a code: a gym's own code or a staff invitation (from a link, a QR code or a
// message). Enter it, check which gym it opens, then accept. An invitation skips approval and
// can make you a trainer. Opened from a link (/community/gyms/invite/CODE) the code is filled in.
// Scanning a QR code with the camera isn't built yet: the code printed under the QR works here.
export default function JoinGym() {
  const params = useLocalSearchParams<{ code?: string }>();
  const getToken = useSessionToken();
  const [code, setCode] = useState(params.code ?? "");
  const [preview, setPreview] = useState<{ gym: Gym; role: "member" | "trainer" } | null>(null);
  const [checking, setChecking] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async (value: string) => {
    const clean = value.replace(/[\s-]/g, "");
    if (clean.length < 8) return setError("Enter the 8 or 10 character code.");
    setChecking(true);
    setError(null);
    const result = await gyms.previewCode(await getToken(), clean);
    setChecking(false);
    if (result.ok) setPreview(result.data);
    else {
      setPreview(null);
      setError(result.error);
    }
  }, [getToken]);

  // A code from a link is checked straight away (after the first render)
  useEffect(() => {
    if (!params.code) return;
    const timer = setTimeout(() => check(params.code ?? ""), 0);
    return () => clearTimeout(timer);
  }, [params.code, check]);

  const accept = async () => {
    if (!preview) return;
    setJoining(true);
    const result = await gyms.joinByCode(await getToken(), code.replace(/[\s-]/g, ""));
    setJoining(false);
    if (!result.ok) return setError(result.error);
    router.replace({ pathname: "/community/gyms/[id]", params: { id: result.data.gym.id } });
  };

  const already = preview?.gym.membership?.status === "active";

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right", "bottom"]}>
        <View className="h-12 flex-row items-center px-5">
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
          </Pressable>
          <Text className="type-subhead ml-3 flex-1 text-forest-ink">Join a gym</Text>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
            <View className="setup__info">
              <SymbolView name={{ ios: "qrcode", android: "qr_code", web: "qr_code" }} size={18} tintColor={colors.forest} />
              <Text className="setup__card-text flex-1">{"Enter the invite code from your gym. It's printed under the gym's QR code and in invite links."}</Text>
            </View>
            <View>
              <Text className="auth__label mb-2">Invite code</Text>
              <TextInput
                value={code}
                onChangeText={(value) => {
                  setCode(value.toUpperCase());
                  setPreview(null);
                }}
                onSubmitEditing={() => check(code)}
                placeholder="ABCD-EFGH"
                placeholderTextColor={colors.faint}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={12}
                accessibilityLabel="Invite code"
                style={{ height: 52, borderRadius: 16, borderWidth: 1, borderColor: colors.creamLine, backgroundColor: colors.white, paddingHorizontal: 16, fontSize: 20, letterSpacing: 2, color: colors.forestInk }}
              />
            </View>
            {error && <FormAlert message={error} />}
            {!preview && (
              <Pressable onPress={() => check(code)} disabled={checking} className="btn-forest" style={{ opacity: checking ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Find gym">
                {checking ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">Find gym</Text>}
              </Pressable>
            )}
            {preview && (
              <View className="post__card gap-3">
                <View className="flex-row items-center gap-3">
                  {preview.gym.logoUrl ? (
                    <AuthImage path={preview.gym.logoUrl} style={{ width: 52, height: 52, borderRadius: 14 }} />
                  ) : (
                    <View className="group__tile"><SymbolView name={{ ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" }} size={22} tintColor={colors.leaf} /></View>
                  )}
                  <View className="flex-1">
                    <Text className="post__author">{preview.gym.name}</Text>
                    <Text className="post__time">{[preview.gym.location, `${preview.gym.memberCount} ${preview.gym.memberCount === 1 ? "member" : "members"}`].filter(Boolean).join(" · ")}</Text>
                  </View>
                </View>
                <Text className="post__body">
                  {already ? `You're already a member of ${preview.gym.name}.` : `Code ${formatCode(code.replace(/[\s-]/g, ""))} adds you as a ${roleLabels[preview.role].toLowerCase()}.`}
                </Text>
                <Pressable onPress={already ? () => router.replace({ pathname: "/community/gyms/[id]", params: { id: preview.gym.id } }) : accept} disabled={joining} className="btn-forest" style={{ opacity: joining ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel={already ? "Open gym" : "Accept invitation"}>
                  {joining ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">{already ? "Open gym" : "Accept invitation"}</Text>}
                </Pressable>
                <Pressable onPress={() => router.back()} className="btn-outline" accessibilityRole="button" accessibilityLabel="Decline">
                  <Text className="btn-outline__label">Not now</Text>
                </Pressable>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
