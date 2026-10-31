import { useCallback, useRef, useState } from "react";
import { Pressable, Text } from "react-native";
import { SymbolView } from "@/components/SymbolView";
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
  // A pull on the shell reads the announcements again as well as the gym
  const reloadList = useRef<(() => Promise<unknown>) | null>(null);
  const onRefresh = useCallback(() => reloadList.current?.() ?? Promise.resolve(), []);
  return (
    <ManageShell
      title="Announcements"
      onRefresh={onRefresh}
      footer={() => (
        <Pressable onPress={() => setSignal((n) => n + 1)} className="btn-forest flex-1 flex-row items-center justify-center gap-2" accessibilityRole="button" accessibilityLabel="New announcement">
          <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={16} tintColor={colors.white} />
          <Text className="btn-forest__label">New announcement</Text>
        </Pressable>
      )}
    >
      {(gym) => <GymAnnouncementsManager gymId={gym.id} getToken={getToken} composeSignal={signal} reloadRef={reloadList} />}
    </ManageShell>
  );
}
