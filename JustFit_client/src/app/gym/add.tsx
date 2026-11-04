import { Text, View } from "react-native";
import { router } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { GymScreen } from "@/components/gym/GymScreen";
import { ADD_ACTIONS } from "@/data/gymDashboard";
import { useThemeColors } from "@/theme";

// Gym admin › +: what to record. Renewals, due payments and PT start by picking the member.
export default function GymAdd() {
  const colors = useThemeColors();
  const open = (id: (typeof ADD_ACTIONS)[number]["id"]) => {
    if (id === "admission") router.push("/gym/admission");
    else if (id === "sale") router.push("/gym/sale");
    else if (id === "service") router.push("/gym/service");
    else if (id === "enquiry") router.push("/gym/enquiry");
    else router.push({ pathname: "/gym/members", params: { pick: id, filter: id === "due" ? "due" : "all" } });
  };
  return (
    <GymScreen title="Record">
      <View style={{ gap: 10 }}>
        {ADD_ACTIONS.map((action) => (
          <PressableScale key={action.id} onPress={() => open(action.id)} className="gym-card gym-tx" accessibilityRole="button" accessibilityLabel={`${action.label}. ${action.note}`}>
            <View className="gym-sms__icon">
              <SymbolView name={action.icon} size={18} tintColor={colors.gymPrimary} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="gym-tx__name">{action.label}</Text>
              <Text className="gym-tx__meta">{action.note}</Text>
            </View>
            <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={13} tintColor={colors.gymFaint} />
          </PressableScale>
        ))}
      </View>
    </GymScreen>
  );
}
