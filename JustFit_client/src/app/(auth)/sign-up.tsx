import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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

// Artwork positions come from the 850px-wide design and scale with the screen
const DESIGN_WIDTH = 850;
const DESIGN_HEIGHT = 1850;


export default function SignUp() {
  const { width } = useWindowDimensions();
  const s = width / DESIGN_WIDTH;
  // Narrow phones: the bowl keeps its place and size, so the title and subtitle are held to
  // the plain area on its left (about 40% of the width) and the subtitle wraps naturally
  const compact = width < 360;
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
        source={images.authSignupBowl}
        style={{ position: "absolute", top: 20 * s, right: 0, width: 465 * s, height: 636 * s }}
      />
      <Image
        source={images.authLeafLeft}
        style={{ position: "absolute", top: 528 * s, left: 0, width: 92 * s, height: 118 * s }}
      />
      <Image
        source={images.authSignupBottomLeft}
        style={{ position: "absolute", bottom: (DESIGN_HEIGHT - 1825) * s, left: 0, width: 232 * s, height: 215 * s }}
      />
      <Image
        source={images.authLeafBottomRight}
        style={{ position: "absolute", bottom: (DESIGN_HEIGHT - 1828) * s, right: 12 * s, width: 216 * s, height: 128 * s }}
      />

      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 30, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            showsVerticalScrollIndicator={false}
          >
            <BrandWordmark />

            {/* The two-line title only reaches the leaves beside the bowl; the subtitle sits lower,
                level with the bowl itself, so on narrow phones it is held to the plain area */}
            <Text className="auth__title mt-8">{"Create your\naccount"}</Text>
            {/* The limit sits on a View: a Text's own maxWidth is ignored on web */}
            <View style={compact ? { maxWidth: Math.round(width * 0.4) } : undefined}>
              <Text className="auth__subtitle mt-3">
                {compact ? "Start your journey to healthy, tasty meals with justFit." : "Start your journey to\nhealthy, tasty meals\nwith justFit."}
              </Text>
            </View>

            {/* Log in / Sign up switch */}
            <View className="auth__tabs mt-9">
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

            <Text className="auth__note mt-4">
              We&apos;ll text you a 6-digit code. By continuing you agree to our <Text className="auth__note-link">{"Terms & Privacy"}</Text>.
            </Text>
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
