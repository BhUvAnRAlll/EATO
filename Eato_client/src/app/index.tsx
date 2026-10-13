import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { useAuth, useClerk, useUser } from "@clerk/expo";

import { FormAlert } from "@/components/FormAlert";
import { PrimaryButton } from "@/components/PrimaryButton";
import { fetchProfile } from "@/lib/profile";
import { claimTrainerRole, getHomeRoute, getRole, needsTrainerRole } from "@/lib/roles";
import { colors } from "@/theme";

// A user whose account doesn't say setup is finished: ask the server before sending
// them through setup, so a reinstall or a cleared account flag doesn't repeat it
function needsProfileCheck(user: { publicMetadata: Record<string, unknown>; unsafeMetadata: Record<string, unknown> }) {
  return getRole(user) === "user" && user.unsafeMetadata.profileComplete !== true && !needsTrainerRole(user);
}

// Start screen. Signed-out people go to onboarding; signed-in people open the
// dashboard for their role (users who haven't finished their profile go to setup first).
export default function Index() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [claimError, setClaimError] = useState<string | null>(null);
  // Bumped by "Try again" to re-run the trainer setup / profile check below
  const [attempt, setAttempt] = useState(0);
  // Result of asking the server whether this user already finished setup
  const [profileCheck, setProfileCheck] = useState<"pending" | "complete" | "incomplete">("pending");

  // New trainer sign-up: ask the server to set the trainer role, then reload the
  // user so the redirect below sees it. Runs again on the next launch if it fails.
  useEffect(() => {
    if (!user || !needsTrainerRole(user)) return;
    let cancelled = false;
    (async () => {
      const result = await claimTrainerRole(await getToken());
      if (cancelled) return;
      if (result.ok) {
        try {
          await user.reload();
        } catch {
          if (!cancelled) setClaimError("We couldn't refresh your account. Please try again.");
        }
      } else {
        setClaimError(result.error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, getToken, attempt]);

  // Existing user on a fresh install (or whose account flag was lost): the server knows
  // whether setup was finished. Once it says yes, the flag is written back so the next
  // launch is instant. If the server can't be reached, show the error (never redo setup).
  useEffect(() => {
    if (!user || !needsProfileCheck(user)) return;
    let cancelled = false;
    (async () => {
      const result = await fetchProfile(await getToken());
      if (cancelled) return;
      if (!result.ok) return setClaimError(result.error);
      if (!result.data.profile?.profileComplete) return setProfileCheck("incomplete");
      setProfileCheck("complete");
      try {
        const kept = user.unsafeMetadata.accountType !== undefined ? { accountType: user.unsafeMetadata.accountType } : {};
        await user.updateMetadata({ unsafeMetadata: { ...kept, profileComplete: true } });
      } catch {
        // The flag is a shortcut only; routing below already uses the server's answer
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, getToken, attempt]);

  const retry = () => {
    setClaimError(null);
    setProfileCheck("pending");
    setAttempt((count) => count + 1);
  };

  if (claimError) {
    return (
      <View className="flex-1 justify-center gap-4 bg-cream px-7.5">
        <FormAlert message={claimError} />
        <PrimaryButton label="Try again" onPress={retry} />
        <Pressable onPress={() => signOut()} className="btn-outline">
          <Text className="btn-outline__label">Sign out</Text>
        </Pressable>
      </View>
    );
  }

  // Wait for Clerk to restore a saved session (and load the user), for a new
  // trainer's role to be set, and for the server's answer on setup, before deciding
  const checking = user !== null && user !== undefined && needsProfileCheck(user) && profileCheck === "pending";
  if (!isLoaded || (isSignedIn && !user) || (user && needsTrainerRole(user)) || checking) {
    return (
      <View className="flex-1 items-center justify-center bg-cream">
        <ActivityIndicator color={colors.forest} />
      </View>
    );
  }

  if (!isSignedIn || !user) return <Redirect href="/onboarding" />;
  if (needsProfileCheck(user) && profileCheck === "complete") return <Redirect href="/home" />;
  return <Redirect href={getHomeRoute(user)} />;
}
