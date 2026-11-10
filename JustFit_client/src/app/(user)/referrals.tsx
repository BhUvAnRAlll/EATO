import { useCallback, useState } from "react";
import { ScrollView, Share, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect } from "expo-router";

import { FieldInput } from "@/components/FieldInput";
import { FormAlert } from "@/components/FormAlert";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";
import { LoadError } from "@/components/macro/LoadError";
import { PressableScale } from "@/components/PressableScale";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { haptic } from "@/lib/haptics";
import { hud } from "@/lib/hud";
import { referralsApi, type MyReferral } from "@/lib/referralsApi";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; data: MyReferral };

// Profile › Invite friends (meal marketing phase 5): my code with Share, how many friends joined,
// and, for a new member who hasn't ordered, a box for a friend's code. The rewards are coupons the
// server makes: the friend's shows on the Meals tab and in the cart; mine arrives as a notification.
export default function ReferralsScreen() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<string | null>(null);

  const read = useCallback(async () => {
    const answer = await referralsApi.mine(await getToken().catch(() => null));
    setLoad(answer.ok ? { state: "ready", data: answer.data } : { state: "failed", error: answer.error });
  }, [getToken]);
  useFocusEffect(useCallback(() => { read(); }, [read]));

  const share = (data: MyReferral) => Share.share({ message: data.shareText }).catch(() => hud.error("Couldn't open sharing"));

  const claim = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const answer = await referralsApi.claim(await getToken().catch(() => null), code.trim());
    setBusy(false);
    if (!answer.ok) return setError(answer.error);
    haptic.success();
    setClaimed(`₹${answer.data.coupon.off} off your first order above ₹${answer.data.coupon.minOrder}. Code ${answer.data.coupon.code} is waiting in your cart's coupons.`);
    read();
  };

  return (
    <View className="flex-1 meal-page">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScreenHeader title="Invite friends" fallback="/profile" />
        <KeyboardAvoider>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 14 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {load.state === "loading" && <ScreenSkeleton label="Loading your code" />}
            {load.state === "failed" && <LoadError tone="meal" title="Your code couldn't load" message={load.error} onRetry={read} />}
            {load.state === "ready" && (
              <>
                <View className="home__card" style={{ gap: 10 }}>
                  <Text className="meal-section__title">{`Give ₹${load.data.reward}, get ₹${load.data.reward}`}</Text>
                  <Text className="meta-text">{`A friend who signs up and uses your code gets ₹${load.data.reward} off their first meal order. When it's delivered, you get ₹${load.data.reward} off your next one.`}</Text>
                  <View className="shop-coupon">
                    <View className="min-w-0 flex-1">
                      <Text className="meta-text">Your code</Text>
                      <Text className="card__title" selectable accessibilityLabel={`Your code ${load.data.code.split("").join(" ")}`}>{load.data.code}</Text>
                    </View>
                  </View>
                  <PressableScale haptic="tap" onPress={() => share(load.data)} className="btn-forest" accessibilityRole="button">
                    <Text className="btn-forest__label">Share my code</Text>
                  </PressableScale>
                  <Text className="meta-text">
                    {load.data.joined === 0
                      ? "No friends have used it yet."
                      : `${load.data.joined} ${load.data.joined === 1 ? "friend" : "friends"} joined · ${load.data.rewarded} ordered`}
                    {load.data.rewarded >= load.data.maxRewards ? ` · You've earned the most rewards (${load.data.maxRewards}).` : ""}
                  </Text>
                </View>
                {claimed ? (
                  <View className="home__card" style={{ gap: 8 }}>
                    <Text className="card__title">{"Friend's code applied"}</Text>
                    <Text className="meta-text">{claimed}</Text>
                    <PressableScale haptic="select" onPress={() => router.replace("/meals")} className="shop-add self-start" accessibilityRole="button">
                      <Text className="shop-add__label">Order now</Text>
                    </PressableScale>
                  </View>
                ) : load.data.canClaim ? (
                  <View className="home__card" style={{ gap: 10 }}>
                    <Text className="card__title">{"Have a friend's code?"}</Text>
                    <View className="setup__field">
                      <FieldInput value={code} onChangeText={(t) => setCode(t.replace(/[^A-Za-z0-9]/g, "").toUpperCase())} placeholder="JF…" placeholderTextColor={colors.faint} autoCapitalize="characters" autoCorrect={false} maxLength={8} accessibilityLabel="Friend's code" />
                    </View>
                    {error ? <FormAlert message={error} /> : null}
                    <PressableScale haptic="tap" onPress={claim} disabled={code.length !== 8 || busy} className={code.length === 8 ? "btn-forest" : "btn-forest btn--disabled"} accessibilityRole="button">
                      <Text className={code.length === 8 ? "btn-forest__label" : "btn-forest__label btn--disabled-label"}>{busy ? "Applying…" : "Apply code"}</Text>
                    </PressableScale>
                  </View>
                ) : null}
              </>
            )}
          </ScrollView>
        </KeyboardAvoider>
      </SafeAreaView>
    </View>
  );
}
