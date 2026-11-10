import { Platform, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { LegalNote } from "@/components/LegalNote";
import { AuthField } from "@/components/AuthField";
import { BrandWordmark } from "@/components/BrandWordmark";
import { FormAlert } from "@/components/FormAlert";
import { PrimaryButton } from "@/components/PrimaryButton";
import { VerificationModal } from "@/components/VerificationModal";
import { images } from "@/constants/images";
import { formatIndianMobile } from "@/lib/phone";
import { useResponsive } from "@/lib/responsive";
import { usePhoneSignIn } from "@/lib/usePhoneSignIn";
import { useAuthStore } from "@/store/auth";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";

// The food art is 480 × 375 px in the design
const ART_RATIO = 480 / 375;

// The photo's height: about 240 pt on a 390-wide phone, following the screen, never taller than
// its own shape at full width, and smaller on short screens so the form card still fits
function artHeight(width: number, height: number, scale: (size: number, bounds?: { min?: number; max?: number }) => number) {
  return Math.round(Math.min(scale(240, { min: 150, max: 290 }), width / ART_RATIO, Math.max(110, height * 0.26)));
}

export default function SignIn() {
  const { width, scale } = useResponsive();
  const { height } = useWindowDimensions();
  const photoHeight = artHeight(width, height, scale);
  const insets = useSafeAreaInsets();
  // Mobile number → a texted 6-digit code → signed in (see lib/usePhoneSignIn.ts)
  const flow = usePhoneSignIn();
  // Set after a sign-out the server couldn't confirm (cleared at the next sign-in)
  const notice = useAuthStore((state) => state.notice);

  return (
    <View className="flex-1 overflow-hidden bg-cream">
      <StatusBar style="auto" />
      <View className="auth__circle" style={{ width: 98, height: 98, right: -42, top: 49 }} />

      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <KeyboardAvoider>
          <ScrollView
            contentContainerStyle={{ flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            showsVerticalScrollIndicator={false}
          >
            <View className="px-7.5">
              <BrandWordmark />
              <Text className="auth__title mt-5">{"Fuel your body,\none meal at a time."}</Text>
              <Text className="auth__subtitle mt-1.5">Fresh, balanced meals made for your goals.</Text>
            </View>

            {/* In the flow below the text with a gap, never behind it, at a fixed height */}
            <Image
              source={images.authLoginArt}
              contentFit="cover"
              contentPosition="center"
              style={{ width, height: photoHeight, marginTop: 16 }}
            />

            {/* Form card: a gap below the photo, then it grows to the bottom of the screen. When
                an error makes it taller than the space, the whole screen scrolls instead */}
            <View className="auth__sheet mt-3" style={{ flexGrow: 1, paddingBottom: insets.bottom + 16 }}>
              {/* Card heading */}
              <Text className="auth__slogan">Welcome back</Text>
              <Text className="auth__subtitle mt-1">Log in with your mobile number.</Text>

              <View className="mt-4">
                <AuthField
                  icon={{ ios: "phone", android: "call", web: "call" }}
                  prefix="+91"
                  placeholder="98765 43210"
                  value={flow.phone}
                  onChangeText={flow.setPhone}
                  keyboardType="number-pad"
                  autoComplete="tel"
                  textContentType="telephoneNumber"
                  accessibilityLabel="Mobile number"
                  returnKeyType="send"
                  onSubmitEditing={flow.sendCode}
                />
              </View>
              <Text className="auth__note mt-2.5">We&apos;ll text you a 6-digit code to log in.</Text>

              {notice && !flow.error && (
                <View className="mt-3">
                  <FormAlert message={notice} />
                </View>
              )}

              {flow.error && (
                <View className="mt-3">
                  <FormAlert message={flow.error} />
                </View>
              )}

              <View className="mt-4">
                <PrimaryButton label="Send code" onPress={flow.sendCode} loading={flow.sending} />
              </View>

              <LegalNote className="mt-3 text-center" lead="By continuing you agree to our" />

              <Text className="auth__footer mt-4 text-center">
                {"New to justFit?  "}
                <Text className="auth__footer-link" onPress={() => router.replace("/sign-up")}>
                  Sign up
                </Text>
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoider>
      </SafeAreaView>

      <VerificationModal
        visible={flow.codeOpen}
        title="Check your messages"
        destination={`+91 ${formatIndianMobile(flow.sentTo)}`}
        onClose={flow.closeCode}
        onComplete={flow.verify}
        onResend={flow.resend}
        resendIn={flow.resendIn}
      />
    </View>
  );
}
