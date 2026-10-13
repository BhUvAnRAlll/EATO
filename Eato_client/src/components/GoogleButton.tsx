import { Image, Pressable, Text } from "react-native";
import { useSSO } from "@clerk/expo";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";

import { images } from "@/constants/images";
import { goAfterSignIn } from "@/lib/auth";
import { getClerkErrorMessage } from "@/lib/clerk";
import type { AccountType } from "@/lib/roles";

// Closes the Google sign-in browser window when it redirects back to the app
WebBrowser.maybeCompleteAuthSession();

type GoogleButtonProps = {
  onError: (message: string) => void;
  // Sign-up screen only: the account type picked for a new account
  accountType?: AccountType;
};

// "Continue with Google" through Clerk; opens home when it succeeds
export function GoogleButton({ onError, accountType }: GoogleButtonProps) {
  const { startSSOFlow } = useSSO();

  const handlePress = async () => {
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: "oauth_google",
        redirectUrl: AuthSession.makeRedirectUri(),
        // Only saved when Google creates a new account (existing accounts just log in)
        unsafeMetadata: accountType ? { accountType } : undefined,
      });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        goAfterSignIn();
      }
    } catch (err) {
      onError(getClerkErrorMessage(err));
    }
  };

  return (
    <Pressable onPress={handlePress} className="auth__social">
      <Image source={images.googleLogo} className="h-5 w-5" />
      <Text className="auth__social-label">Continue with Google</Text>
    </Pressable>
  );
}
