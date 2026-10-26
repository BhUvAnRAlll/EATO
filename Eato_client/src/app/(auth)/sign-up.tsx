import { useState } from "react";
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
import { useSignUp } from "@clerk/expo";

import { AuthField } from "@/components/AuthField";
import { BrandWordmark } from "@/components/BrandWordmark";
import { FormAlert } from "@/components/FormAlert";
import { GoogleButton } from "@/components/GoogleButton";
import { PrimaryButton } from "@/components/PrimaryButton";
import { VerificationModal } from "@/components/VerificationModal";
import { Chip } from "@/components/setup/Chip";
import { images } from "@/constants/images";
import { goAfterSignIn } from "@/lib/auth";
import { getClerkErrorMessage } from "@/lib/clerk";
import type { AccountType } from "@/lib/roles";
import type { Option } from "@/types/profile";

// Artwork positions come from the 850px-wide design and scale with the screen
const DESIGN_WIDTH = 850;
const DESIGN_HEIGHT = 1850;

const accountTypes: Option<AccountType>[] = [
  { id: "user", label: "User" },
  { id: "trainer", label: "Trainer" },
];

export default function SignUp() {
  const { width } = useWindowDimensions();
  const s = width / DESIGN_WIDTH;
  // Narrow phones: the bowl keeps its place and size, so the title and subtitle are held to
  // the plain area on its left (about 40% of the width) and the subtitle wraps naturally
  const compact = width < 360;
  const { signUp } = useSignUp();

  const [accountType, setAccountType] = useState<AccountType>("user");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  // Creates the account and emails a 6-digit code
  const handleSubmit = async () => {
    setError(null);
    setIsSubmitting(true);
    const [firstName, ...rest] = fullName.trim().split(/\s+/);
    const { error: createError } = await signUp.create({
      emailAddress: email.trim(),
      password,
      firstName: firstName || undefined,
      lastName: rest.join(" ") || undefined,
      // The server turns "trainer" into the real role after sign up (POST /api/account-type, see Eato_server/auth.js)
      unsafeMetadata: { accountType },
    });
    const { error: sendError } = createError ? { error: null } : await signUp.verifications.sendEmailCode();
    setIsSubmitting(false);

    const failure = createError ?? sendError;
    if (failure) setError(getClerkErrorMessage(failure));
    else setIsVerifying(true);
  };

  // Checks the code, then signs the new user in
  const handleVerify = async (code: string) => {
    const { error: verifyError } = await signUp.verifications.verifyEmailCode({ code });
    if (verifyError) return getClerkErrorMessage(verifyError);
    if (signUp.status !== "complete") return "We couldn't finish creating your account. Please try again.";

    const { error: finalizeError } = await signUp.finalize();
    if (finalizeError) return getClerkErrorMessage(finalizeError);
    setIsVerifying(false);
    goAfterSignIn();
    return null;
  };

  return (
    <View className="flex-1 overflow-hidden bg-cream">
      <StatusBar style="dark" />

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
            showsVerticalScrollIndicator={false}
          >
            <BrandWordmark />

            {/* The two-line title only reaches the leaves beside the bowl; the subtitle sits lower,
                level with the bowl itself, so on narrow phones it is held to the plain area */}
            <Text className="auth__title mt-8">{"Create your\naccount"}</Text>
            {/* The limit sits on a View: a Text's own maxWidth is ignored on web */}
            <View style={compact ? { maxWidth: Math.round(width * 0.4) } : undefined}>
              <Text className="auth__subtitle mt-3">
                {compact ? "Start your journey to healthy, tasty meals with JustFit." : "Start your journey to\nhealthy, tasty meals\nwith JustFit."}
              </Text>
            </View>

            {/* Log in / Sign up switch */}
            <View className="auth__tabs mt-9">
              <Pressable onPress={() => router.replace("/sign-in")} className="auth__tab">
                <Text className="auth__tab-label">Log in</Text>
              </Pressable>
              <View className="auth__tab auth__tab--active">
                <Text className="auth__tab-label auth__tab-label--active">Sign up</Text>
              </View>
            </View>

            <View className="mt-5 gap-3.5">
              <View className="gap-2">
                <Text className="auth__label">Account type</Text>
                <View className="flex-row gap-2">
                  {accountTypes.map((type) => (
                    <Chip
                      key={type.id}
                      grow
                      label={type.label}
                      selected={accountType === type.id}
                      onPress={() => setAccountType(type.id)}
                    />
                  ))}
                </View>
              </View>
              <AuthField
                label="Full name"
                icon={{ ios: "person", android: "person", web: "person" }}
                placeholder="Aarav Sharma"
                value={fullName}
                onChangeText={setFullName}
                autoCapitalize="words"
                autoComplete="name"
                textContentType="name"
              />
              <AuthField
                label="Email"
                icon={{ ios: "envelope", android: "mail", web: "mail" }}
                placeholder="aarav.sharma@email.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                textContentType="emailAddress"
              />
              <AuthField
                label="Password"
                icon={{ ios: "lock", android: "lock", web: "lock" }}
                placeholder="At least 8 characters"
                value={password}
                onChangeText={setPassword}
                isPassword
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
              />
            </View>

            <Text className="auth__note mt-4">
              By continuing you agree to our <Text className="auth__note-link">{"Terms & Privacy"}</Text>.
            </Text>
            {error && (
              <View className="mt-3">
                <FormAlert message={error} />
              </View>
            )}

            <View className="mt-4">
              <PrimaryButton label="Create account" onPress={handleSubmit} loading={isSubmitting} />
            </View>

            <View className="mt-6 flex-row items-center gap-5 px-1">
              <View className="auth__divider-line" />
              <Text className="auth__divider-label">OR</Text>
              <View className="auth__divider-line" />
            </View>

            <View className="mt-4">
              <GoogleButton onError={setError} accountType={accountType} />
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
        visible={isVerifying}
        email={email}
        onClose={() => setIsVerifying(false)}
        onComplete={handleVerify}
        onResend={() => signUp.verifications.sendEmailCode()}
      />
    </View>
  );
}
