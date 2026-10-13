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
import { SymbolView } from "expo-symbols";

import { FormAlert } from "@/components/FormAlert";
import { getClerkErrorMessage } from "@/lib/clerk";
import { colors } from "@/theme";

const CODE_LENGTH = 6;

type VerificationModalProps = {
  visible: boolean;
  email: string;
  onClose: () => void;
  // Returns an error message, or null when the code was accepted
  onComplete: (code: string) => Promise<string | null>;
  onResend: () => void;
};

export function VerificationModal({ visible, email, onClose, onComplete, onResend }: VerificationModalProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const handleChange = async (text: string) => {
    const digits = text.replace(/[^0-9]/g, "").slice(0, CODE_LENGTH);
    setCode(digits);
    setError(null);
    if (digits.length < CODE_LENGTH) return;

    setIsChecking(true);
    try {
      const message = await onComplete(digits);
      setCode("");
      setError(message);
    } catch (err) {
      setError(getClerkErrorMessage(err));
    } finally {
      setIsChecking(false);
    }
  };

  const handleClose = () => {
    setCode("");
    setError(null);
    onClose();
  };

  const handleResend = () => {
    setCode("");
    setError(null);
    onResend();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      {/* Keeps the sheet sitting right above the keyboard */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View className="verify__backdrop">
          <Pressable className="flex-1" onPress={handleClose} />

          <View className="verify__sheet">
            <View className="flex-row items-start justify-between">
              <Text className="type-title text-ink">Check your email</Text>
              <Pressable onPress={handleClose} hitSlop={12} className="pt-1">
                <SymbolView
                  name={{ ios: "xmark", android: "close", web: "close" }}
                  size={20}
                  tintColor={colors.muted}
                />
              </Pressable>
            </View>
            <Text className="auth__subtitle mt-2">
              We sent a {CODE_LENGTH}-digit verification code to{" "}
              <Text className="auth__footer-link">{email || "your email"}</Text>. Enter it below.
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
                <Text className="auth__footer-link" onPress={handleResend}>
                  Resend
                </Text>
              </Text>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
