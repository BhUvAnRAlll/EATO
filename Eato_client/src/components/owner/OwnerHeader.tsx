import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";

import { ActionSheet } from "@/components/community/ActionSheet";
import { useOwnerStore } from "@/store/owner";
import { colors } from "@/theme";

type Props = { title: string; subtitle: string };

// The top of every owner portal tab: the gym's name as the eyebrow (a switcher when the
// caller runs more than one gym), the tab's title and a line about it, and the way back to
// the member app (⇄).
export function OwnerHeader({ title, subtitle }: Props) {
  const gyms = useOwnerStore((state) => state.gyms);
  const gymId = useOwnerStore((state) => state.gymId);
  const summary = useOwnerStore((state) => state.summary);
  const setGym = useOwnerStore((state) => state.setGym);
  const [switching, setSwitching] = useState(false);

  const gymName = summary?.gym.name ?? gyms?.find((g) => g.id === gymId)?.name ?? "Your gym";
  const canSwitch = (gyms?.length ?? 0) > 1;
  const platform = summary?.gym.as === "platform";

  return (
    <View className="gap-1 px-5 pt-3">
      <View className="flex-row items-center justify-between">
        <Pressable
          onPress={() => setSwitching(true)}
          disabled={!canSwitch}
          className="flex-row items-center gap-1"
          accessibilityRole={canSwitch ? "button" : "text"}
          accessibilityLabel={canSwitch ? `${gymName}. Switch gym` : gymName}
        >
          <Text className="home__eyebrow" numberOfLines={1}>{platform ? `${gymName} · JustFit admin` : gymName}</Text>
          {canSwitch && <SymbolView name={{ ios: "chevron.down", android: "expand_more", web: "expand_more" }} size={12} tintColor={colors.muted} />}
        </Pressable>
        <Pressable onPress={() => router.replace("/")} hitSlop={8} className="owner__header-button" accessibilityRole="button" accessibilityLabel="Leave Gym Manager">
          <SymbolView name={{ ios: "arrow.left.arrow.right", android: "swap_horiz", web: "swap_horiz" }} size={20} tintColor={colors.ink} />
        </Pressable>
      </View>
      <Text className="community__title">{title}</Text>
      <Text className="owner__subtitle">{subtitle}</Text>
      <ActionSheet
        visible={switching}
        title="Switch gym"
        actions={(gyms ?? []).map((gym) => ({ label: gym.id === gymId ? `${gym.name} ✓` : gym.name, onPress: () => setGym(gym.id) }))}
        onClose={() => setSwitching(false)}
      />
    </View>
  );
}
