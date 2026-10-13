import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router, useLocalSearchParams } from "expo-router";
import { useSignIn } from "@clerk/expo";

import { AuthField } from "@/components/AuthField";
import { BrandWordmark } from "@/components/BrandWordmark";
import { FormAlert } from "@/components/FormAlert";
import { PrimaryButton } from "@/components/PrimaryButton";
import { VerificationModal } from "@/components/VerificationModal";
import { goAfterSignIn } from "@/lib/auth";
import { getClerkErrorMessage } from "@/lib/clerk";
import { colors } from "@/theme";

// Step 1: email → 6-digit code. Step 2: choose a new password (signs the user in).
export default function ForgotPassword() {
  const params = useLocalSearchParams<{ email?: string }>();
  const { signIn } = useSignIn();

  const [step, setStep] = useState<"email" | "new-password">("email");
  const [email, setEmail] = useState(params.email ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  const sendResetCode = async () => {
    const { error: createError } = await signIn.create({ identifier: email.trim() });
    if (createError) return getClerkErrorMessage(createError);
    const { error: sendError } = await signIn.resetPasswordEmailCode.sendCode();
    return sendError ? getClerkErrorMessage(sendError) : null;
  };

  const handleSendCode = async () => {
    setError(null);
    setIsSubmitting(true);
    const message = await sendResetCode();
    setIsSubmitting(false);
    if (message) setError(message);
    else setIsVerifying(true);
  };

  const handleVerify = async (code: string) => {
    const { error: verifyError } = await signIn.resetPasswordEmailCode.verifyCode({ code });
    if (verifyError) return getClerkErrorMessage(verifyError);
    setIsVerifying(false);
    setStep("new-password");
    return null;
  };

  const handleResetPassword = async () => {
    setError(null);
    setIsSubmitting(true);
    const message = await resetPassword();
    setIsSubmitting(false);
    if (message) setError(message);
  };

  const resetPassword = async () => {
    const { error: submitError } = await signIn.resetPasswordEmailCode.submitPassword({ password });
    if (submitError) return getClerkErrorMessage(submitError);
    if (signIn.status !== "complete") return "Password updated. Please log in with your new password.";

    const { error: finalizeError } = await signIn.finalize();
    if (finalizeError) return getClerkErrorMessage(finalizeError);
    goAfterSignIn();
    return null;
  };

  const isEmailStep = step === "email";

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <View className="auth__circle" style={{ width: 98, height: 98, right: -42, top: 49 }} />

      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 30, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Pressable onPress={() => router.back()} hitSlop={12} className="mb-5 self-start">
              <SymbolView
                name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }}
                size={20}
                tintColor={colors.forestInk}
              />
            </Pressable>

            <BrandWordmark />

            <Text className="auth__title mt-8">{isEmailStep ? "Forgot your\npassword?" : "Choose a new\npassword"}</Text>
            <Text className="auth__subtitle mt-3">
              {isEmailStep
                ? "Enter your email and we'll send you a\n6-digit code to reset it."
                : "Use at least 8 characters. You'll be\nlogged in right after."}
            </Text>

            <View className="mt-8">
              {isEmailStep ? (
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
              ) : (
                <AuthField
                  label="New password"
                  icon={{ ios: "lock", android: "lock", web: "lock" }}
                  placeholder="At least 8 characters"
                  value={password}
                  onChangeText={setPassword}
                  isPassword
                  autoCapitalize="none"
                  autoComplete="new-password"
                  textContentType="newPassword"
                />
              )}
            </View>

            {error && (
              <View className="mt-3">
                <FormAlert message={error} />
              </View>
            )}

            <View className="mt-5">
              {isEmailStep ? (
                <PrimaryButton label="Send code" onPress={handleSendCode} loading={isSubmitting} />
              ) : (
                <PrimaryButton label="Reset password" onPress={handleResetPassword} loading={isSubmitting} />
              )}
            </View>

            <Text className="auth__footer mt-6 text-center">
              {"Remembered it?  "}
              <Text className="auth__footer-link" onPress={() => router.back()}>
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
        onResend={() => signIn.resetPasswordEmailCode.sendCode()}
      />
    </View>
  );
}
