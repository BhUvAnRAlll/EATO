import { Pressable, Text, View } from "react-native";
import { useClerk, useUser } from "@clerk/expo";

import { PlaceholderScreen } from "@/components/PlaceholderScreen";

// Profile: greeting, account email and sign out (the rest comes with the Profile feature)
export default function Profile() {
  const { user } = useUser();
  const { signOut } = useClerk();

  return (
    <PlaceholderScreen
      title="Profile"
      subtitle="Orders, wallet, coupons, addresses, goals, achievements and settings."
      icon={{ ios: "person", android: "person", web: "person" }}
    >
      <View className="card gap-1">
        <Text className="setup__title">{user?.firstName ? `Hi, ${user.firstName}!` : "Welcome!"}</Text>
        <Text className="type-caption text-muted">{user?.primaryEmailAddress?.emailAddress}</Text>
      </View>
      {/* Signing out removes these screens; the start screen then opens onboarding */}
      <Pressable onPress={() => signOut()} className="btn-outline mt-4">
        <Text className="btn-outline__label">Sign out</Text>
      </Pressable>
    </PlaceholderScreen>
  );
}
