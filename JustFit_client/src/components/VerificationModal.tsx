import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SymbolView } from "@/components/SymbolView";

import { FormAlert } from "@/components/FormAlert";
import { codeInput } from "@/lib/phone";
import { useThemeColors } from "@/theme";

const CODE_LENGTH = 6;

type VerificationModalProps = {
  visible: boolean;
  title: string;
  // Where the code went, shown in the sentence (e.g. "+91 98765 43210")
  destination: string;
  onClose: () => void;
  // Returns an error message, or null when the code was accepted
  onComplete: (code: string) => Promise<string | null>;
  // Sends a new code; returns an error message, or null once it is on its way
  onResend: () => Promise<string | null>;
  // Seconds until Resend is allowed (0: now)
  resendIn: number;
};

export function VerificationModal({ visible, title, destination, onClose, onComplete, onResend, resendIn }: VerificationModalProps) {
  const colors = useThemeColors();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const handleChange = async (text: string) => {
    const digits = codeInput(text);
    setCode(digits);
    setError(null);
    if (digits.length < CODE_LENGTH) return;

    setIsChecking(true);
    try {
      const message = await onComplete(digits);
      setCode("");
      setError(message);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsChecking(false);
    }
  };

  const handleClose = () => {
    setCode("");
    setError(null);
    onClose();
  };

  const handleResend = async () => {
    if (resendIn > 0) return;
    setCode("");
    setError(null);
    setError(await onResend());
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      {/* Keeps the sheet sitting right above the keyboard */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View className="verify__backdrop">
          <Pressable className="flex-1" onPress={handleClose} accessibilityRole="button" accessibilityLabel="Close" />

          <View className="verify__sheet">
            <View className="flex-row items-start justify-between">
              <Text className="type-title text-ink">{title}</Text>
              <Pressable onPress={handleClose} hitSlop={12} className="pt-1" accessibilityRole="button" accessibilityLabel="Close">
                <SymbolView
                  name={{ ios: "xmark", android: "close", web: "close" }}
                  size={20}
                  tintColor={colors.muted}
                />
              </Pressable>
            </View>
            <Text className="auth__subtitle mt-2">
              We sent a {CODE_LENGTH}-digit code to{" "}
              <Text className="auth__footer-link">{destination}</Text>. Enter it below.
            </Text>

            {/* One hidden input drives the six boxes */}
            <View className="mt-6">
              <View className="flex-row gap-2">
                {Array.from({ length: CODE_LENGTH }, (_, i) => (
                  <View
                    key={i}
                    className={i === code.length ? "verify__cell verify__cell--active" : "verify__cell"}
                  >
                    <Text className="verify__digit">{code[i] ?? ""}</Text>
                  </View>
                ))}
              </View>
              <TextInput
                value={code}
                onChangeText={handleChange}
                editable={!isChecking}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                maxLength={CODE_LENGTH}
                autoFocus
                caretHidden
                style={{ position: "absolute", width: "100%", height: "100%", opacity: 0 }}
              />
            </View>

            {error && !isChecking && (
              <View className="mt-4">
                <FormAlert message={error} />
              </View>
            )}

            <View className="mt-4 min-h-5 flex-row items-center justify-between">
              <View>{isChecking && <ActivityIndicator color={colors.ink} />}</View>
              <Text className="auth__note">
                {"Didn't get it? "}
                {resendIn > 0 ? (
                  <Text accessibilityLabel={`Resend in ${resendIn} seconds`}>Resend in {resendIn}s</Text>
                ) : (
                  <Text className="auth__footer-link" onPress={handleResend} accessibilityRole="button">
                    Resend
                  </Text>
                )}
              </Text>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
