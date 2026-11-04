import { Pressable, Text, View } from "react-native";

import { SymbolView } from "@/components/SymbolView";
import { GymSheet } from "@/components/gym/GymSheet";
import { ADD_SHEET, type AddAction } from "@/data/gymDashboard";
import { useThemeColors } from "@/theme";

// Home's + (the user's design): Add Member, Add Plan, Add Enquiry, Add Expense, Add Outlet, Add
// Staff / Admin Login, Send Bulk SMS, Biometric Attendance
export function AddSheet({ onClose, onPick }: { onClose: () => void; onPick: (action: AddAction) => void }) {
  const colors = useThemeColors();
  const row = (item: (typeof ADD_SHEET)[number]) => (
    <Pressable key={item.id} onPress={() => onPick(item.id)} className="gym-addrow" accessibilityRole="button" accessibilityLabel={item.label}>
      <View className="gym-addrow__icon">
        <SymbolView name={item.icon} size={18} tintColor={colors.gymPrimary} />
      </View>
      <Text className="gym-menu__label flex-1" numberOfLines={1}>{item.label}</Text>
      <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={13} tintColor={colors.gymInk} />
    </Pressable>
  );
  return (
    <GymSheet onClose={onClose}>
      <View>{ADD_SHEET.map(row)}</View>
    </GymSheet>
  );
}
