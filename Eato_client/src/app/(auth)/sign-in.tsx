import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";
import { useSignIn } from "@clerk/expo";

import { AuthField } from "@/components/AuthField";
import { BrandWordmark } from "@/components/BrandWordmark";
import { FormAlert } from "@/components/FormAlert";
import { GoogleButton } from "@/components/GoogleButton";
import { PrimaryButton } from "@/components/PrimaryButton";
import { VerificationModal } from "@/components/VerificationModal";
import { images } from "@/constants/images";
import { goAfterSignIn } from "@/lib/auth";
import { getClerkErrorMessage } from "@/lib/clerk";

// The food art is 480 × 375 px in the design; it tucks ~25pt up beside the subtitle
const ART_RATIO = 480 / 375;
const ART_OVERLAP = 25;

export default function SignIn() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { signIn } = useSignIn();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  // Email + password. On a new device Clerk may also ask for an emailed code.
  const handleSubmit = async () => {
    setError(null);
    setIsSubmitting(true);
    const message = await signInWithPassword();
    setIsSubmitting(false);
    if (message) setError(message);
  };

  const signInWithPassword = async () => {
    const { error: passwordError } = await signIn.password({ identifier: email.trim(), password });
    if (passwordError) return getClerkErrorMessage(passwordError);

    if (signIn.status === "complete") {
      const { error: finalizeError } = await signIn.finalize();
      if (finalizeError) return getClerkErrorMessage(finalizeError);
      goAfterSignIn();
      return null;
    }

    // New device: confirm it's really them with a code sent to their email
    if (signIn.status === "needs_client_trust" || signIn.status === "needs_second_factor") {
      const { error: sendError } = await signIn.mfa.sendEmailCode();
      if (sendError) return getClerkErrorMessage(sendError);
      setIsVerifying(true);
      return null;
    }

    return "We couldn't log you in. Please try again.";
  };

  const handleVerify = async (code: string) => {
    const { error: verifyError } = await signIn.mfa.verifyEmailCode({ code });
    if (verifyError) return getClerkErrorMessage(verifyError);
    if (signIn.status !== "complete") return "We couldn't log you in. Please try again.";

    const { error: finalizeError } = await signIn.finalize();
    if (finalizeError) return getClerkErrorMessage(finalizeError);
    setIsVerifying(false);
    goAfterSignIn();
    return null;
  };

  return (
    <View className="flex-1 overflow-hidden bg-cream">
      <StatusBar style="dark" />
      <View className="auth__circle" style={{ width: 98, height: 98, right: -42, top: 49 }} />

      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView
            contentContainerStyle={{ flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
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
              style={{ width, flex: 1, minHeight: 120, maxHeight: width / ART_RATIO, marginTop: width < 360 ? 0 : -ART_OVERLAP }}
            />

            {/* Form card */}
            <View className="auth__sheet -mt-5" style={{ paddingBottom: insets.bottom + 8 }}>
              {/* Card heading */}
              <Text className="auth__slogan">Welcome back</Text>
              <Text className="auth__subtitle mt-1">Log in to continue your healthy journey.</Text>

              <View className="mt-4 gap-3">
                <AuthField
                  icon={{ ios: "envelope", android: "mail", web: "mail" }}
                  placeholder="Email address"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  textContentType="emailAddress"
                />
                <AuthField
                  icon={{ ios: "lock", android: "lock", web: "lock" }}
                  placeholder="Password"
                  value={password}
                  onChangeText={setPassword}
                  isPassword
                  autoCapitalize="none"
                  autoComplete="current-password"
                  textContentType="password"
                />
              </View>

              <Text
                className="auth__link mt-2.5 self-end"
                onPress={() => router.push({ pathname: "/forgot-password", params: { email: email.trim() } })}
              >
                Forgot password?
              </Text>

              {error && (
                <View className="mt-3">
                  <FormAlert message={error} />
                </View>
              )}

              <View className="mt-4">
                <PrimaryButton label="Log in" onPress={handleSubmit} loading={isSubmitting} />
              </View>

              <View className="mt-4 flex-row items-center gap-5 px-1">
                <View className="auth__divider-line" />
                <Text className="auth__divider-label">OR</Text>
                <View className="auth__divider-line" />
              </View>

              <View className="mt-3">
                <GoogleButton onError={setError} />
              </View>

              <Text className="auth__footer mt-4 text-center">
                {"Don't have an account?  "}
                <Text className="auth__footer-link" onPress={() => router.replace("/sign-up")}>
                  Sign up
                </Text>
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <VerificationModal
        visible={isVerifying}
        email={email}
        onClose={() => setIsVerifying(false)}
        onComplete={handleVerify}
        onResend={() => signIn.mfa.sendEmailCode()}
      />
    </View>
  );
}
