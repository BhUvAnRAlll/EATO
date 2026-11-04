import { Pressable, Text, View } from "react-native";

import { GymIcon } from "@/components/gym/GymIcon";
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
        <GymIcon name={item.icon} size={18} color={colors.gymPrimary} />
      </View>
      <Text className="gym-menu__label flex-1" numberOfLines={1}>{item.label}</Text>
      <GymIcon name="chevron-right" size={13} color={colors.gymInk} />
    </Pressable>
  );
  return (
    <GymSheet onClose={onClose}>
      <View>{ADD_SHEET.map(row)}</View>
    </GymSheet>
  );
}
