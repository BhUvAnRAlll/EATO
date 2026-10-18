import { useState } from "react";
import { Pressable, Text } from "react-native";
import { SymbolView } from "expo-symbols";
import { useLocalSearchParams } from "expo-router";

import { GymAnnouncementsManager } from "@/components/gyms/GymAnnouncementsManager";
import { ManageShell } from "@/components/gyms/ManageShell";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

// Manage › Announcements: the list with Pin, Edit and Delete, and New announcement at the bottom.
// Opened from "Announce" (?compose=1) the editor opens straight away.
export default function ManageAnnouncements() {
  const { compose } = useLocalSearchParams<{ compose?: string }>();
  const getToken = useSessionToken();
  const [signal, setSignal] = useState(compose === "1" ? 1 : 0);
  return (
    <ManageShell
      title="Announcements"
      footer={() => (
        <Pressable onPress={() => setSignal((n) => n + 1)} className="btn-forest flex-1 flex-row items-center justify-center gap-2" accessibilityRole="button" accessibilityLabel="New announcement">
          <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={16} tintColor={colors.white} />
          <Text className="btn-forest__label">New announcement</Text>
        </Pressable>
      )}
    >
      {(gym) => <GymAnnouncementsManager gymId={gym.id} getToken={getToken} composeSignal={signal} />}
    </ManageShell>
  );
}
