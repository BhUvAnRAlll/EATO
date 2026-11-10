import { Image, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
import { KeyboardAvoider } from "@/components/KeyboardAvoider";

// The background artwork's positions come from the 850px-wide design and scale with the screen
const DESIGN_WIDTH = 850;
const DESIGN_HEIGHT = 1850;
// The bowl photo is 930 × 1272 px
const BOWL_RATIO = 930 / 1272;
// The scroll's side padding: the bowl runs past it to the screen's right edge
const GUTTER = 30;

export default function SignUp() {
  const { width, compact, scale } = useResponsive();
  const s = width / DESIGN_WIDTH;
  // The bowl sits beside the title and subtitle, below the logo and above the Log in / Sign up
  // switch, so it never covers either; it is sized to leave the text room on narrow phones
  const bowlWidth = compact ? scale(140, { min: 112, max: 140 }) : scale(190, { min: 160, max: 220 });
  // One flow for new and returning members: the code makes a member account for a new number
  // (admins are set up by justFit, never picked here; your name comes in setup)
  const flow = usePhoneSignIn();

  return (
    <View className="flex-1 overflow-hidden bg-cream">
      <StatusBar style="auto" />

      {/* Background artwork (positions in design pixels × s) */}
      <View className="auth__circle" style={{ width: 145 * s, height: 145 * s, left: -95 * s, top: 255 * s }} />
      <View className="auth__circle" style={{ width: 220 * s, height: 220 * s, right: -160 * s, top: 1250 * s }} />
      <Image
        source={images.authSignupBottomLeft}
        style={{ position: "absolute", bottom: (DESIGN_HEIGHT - 1825) * s, left: 0, width: 232 * s, height: 215 * s }}
      />
      <Image
        source={images.authLeafBottomRight}
        style={{ position: "absolute", bottom: (DESIGN_HEIGHT - 1828) * s, right: 12 * s, width: 216 * s, height: 128 * s }}
      />

      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoider>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            showsVerticalScrollIndicator={false}
          >
            <BrandWordmark />

            {/* Title and subtitle on the left, the bowl on the right running to the screen edge */}
            <View className="mt-4 flex-row items-center">
              <View className="min-w-0 flex-1 pr-2">
                <Text className="auth__title">{"Create your\naccount"}</Text>
                <Text className="auth__subtitle mt-3">Start your journey to healthy, tasty meals with justFit.</Text>
              </View>
              <Image
                source={images.authSignupBowl}
                resizeMode="contain"
                style={{ width: bowlWidth, height: Math.round(bowlWidth / BOWL_RATIO), marginRight: -GUTTER }}
                accessibilityIgnoresInvertColors
              />
            </View>

            {/* Log in / Sign up switch */}
            <View className="auth__tabs mt-5">
              <Pressable onPress={() => router.replace("/sign-in")} className="auth__tab" accessibilityRole="tab" accessibilityState={{ selected: false }}>
                <Text className="auth__tab-label">Log in</Text>
              </Pressable>
              <View className="auth__tab auth__tab--active">
                <Text className="auth__tab-label auth__tab-label--active">Sign up</Text>
              </View>
            </View>

            <View className="mt-5">
              <AuthField
                label="Mobile number"
                onPage
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

            <LegalNote className="mt-4" lead="We'll text you a 6-digit code. By continuing you agree to our" />
            {flow.error && (
              <View className="mt-3">
                <FormAlert message={flow.error} />
              </View>
            )}

            <View className="mt-4">
              <PrimaryButton label="Send code" onPress={flow.sendCode} loading={flow.sending} />
            </View>

            <Text className="auth__footer mt-6 text-center">
              {"Already have an account?  "}
              <Text className="auth__footer-link" onPress={() => router.replace("/sign-in")}>
                Log in
              </Text>
            </Text>
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
