import { KeyboardAvoidingView, Platform, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { AuthField } from "@/components/AuthField";
import { BrandWordmark } from "@/components/BrandWordmark";
import { FormAlert } from "@/components/FormAlert";
import { PrimaryButton } from "@/components/PrimaryButton";
import { VerificationModal } from "@/components/VerificationModal";
import { images } from "@/constants/images";
import { formatIndianMobile } from "@/lib/phone";
import { usePhoneSignIn } from "@/lib/usePhoneSignIn";
import { useAuthStore } from "@/store/auth";
import { useScheme } from "@/theme";

// The food art is 480 × 375 px in the design; it tucks ~25pt up beside the subtitle
const ART_RATIO = 480 / 375;
const ART_OVERLAP = 25;

export default function SignIn() {
  const { width } = useWindowDimensions();
  // The photo was made to melt into a light page; on a dark page it sits as a rounded card
  // below the text instead of tucking under it
  const dark = useScheme() === "dark";
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
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView
            contentContainerStyle={{ flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            showsVerticalScrollIndicator={false}
          >
            {/* Drawn above the photo: the photo tucks under the text block by ART_OVERLAP, and
                the subtitle's second line must stay in front of it on every width */}
            <View className="px-7.5" style={{ zIndex: 1 }}>
              <BrandWordmark />
              <Text className="auth__title mt-5">{"Fuel your body,\none meal at a time."}</Text>
              <Text className="auth__subtitle mt-1.5">{"Fresh, balanced meals made\nfor your goals."}</Text>
            </View>

            <Image
              source={images.authLoginArt}
              contentFit="cover"
              contentPosition="center"
              // Fills the space left over, so the screen fits without scrolling. The photo tucks
              // under the text by ART_OVERLAP, except on narrow phones where the cropped photo
              // would put food right behind the subtitle: there it starts just below the text.
              style={dark
                ? { width: width - 32, marginHorizontal: 16, borderRadius: 24, flex: 1, minHeight: 120, maxHeight: (width - 32) / ART_RATIO, marginTop: 16, marginBottom: 28 }
                : { width, flex: 1, minHeight: 120, maxHeight: width / ART_RATIO, marginTop: width < 360 ? 0 : -ART_OVERLAP }}
            />

            {/* Form card */}
            <View className="auth__sheet -mt-5" style={{ paddingBottom: insets.bottom + 8 }}>
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

              <Text className="auth__footer mt-4 text-center">
                {"New to justFit?  "}
                <Text className="auth__footer-link" onPress={() => router.replace("/sign-up")}>
                  Sign up
                </Text>
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
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
