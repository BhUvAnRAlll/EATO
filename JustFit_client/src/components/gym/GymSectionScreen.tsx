import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GymScreen } from "@/components/gym/GymScreen";
import { GymEmpty } from "@/components/gym/GymStates";
import type { StaffOption } from "@/lib/gymApi";
import { useCan } from "@/store/gymAccess";

// Plans / Catalogue, Enquiries and Expenses opened over Home as their own screens (like Likely to
// leave), so the back chevron, the iOS edge swipe and Android back all return to where they came
// from. The list scrolls itself and draws its own round +, kept above the home indicator here.
// A Staff login without the list's option (`need`) sees a note instead (the server refuses the data anyway).
export function GymSectionScreen({ title, need, children }: { title: string; need: StaffOption; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const can = useCan();
  return (
    <GymScreen title={title} scroll={false}>
      {can(need) ? (
        <View style={{ flex: 1, paddingBottom: insets.bottom }}>{children}</View>
      ) : (
        <View className="p-4">
          <GymEmpty icon="layout-grid" title={`No access to ${title}`} text={`Your login doesn't include ${title}. Ask your gym admin.`} />
        </View>
      )}
    </GymScreen>
  );
}
