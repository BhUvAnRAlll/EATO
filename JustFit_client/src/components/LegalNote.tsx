import { Text } from "react-native";
import { router } from "expo-router";

type LegalNoteProps = {
  // The words before the links, e.g. "By continuing you agree to our"
  lead: string;
  className?: string;
};

// "<lead> Terms & Conditions and Privacy Policy.", both tappable (app/legal/[doc].tsx). Used where
// someone agrees: sign-in, sign-up, checkout, Subscribe and Register your gym.
export function LegalNote({ lead, className = "" }: LegalNoteProps) {
  return (
    <Text className={`auth__note ${className}`}>
      {`${lead} `}
      <Text className="auth__note-link" onPress={() => router.push("/legal/terms")} accessibilityRole="link">
        Terms & Conditions
      </Text>
      {" and "}
      <Text className="auth__note-link" onPress={() => router.push("/legal/privacy")} accessibilityRole="link">
        Privacy Policy
      </Text>
      .
    </Text>
  );
}
