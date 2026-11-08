import { Pressable, Text, View } from "react-native";

import { GymIcon } from "@/components/gym/GymIcon";
import { GymSheet } from "@/components/gym/GymSheet";
import { ADD_SHEET, type AddAction } from "@/data/gymDashboard";
import type { StaffOption } from "@/lib/gymApi";
import { useCan } from "@/store/gymAccess";
import { useThemeColors } from "@/theme";

// The Role & Permission option each item needs (none: open to every portal login)
const AREA_FOR: Partial<Record<AddAction, StaffOption>> = { member: "members.add", plan: "catalog.edit", enquiry: "enquiries.edit", sms: "sms.send", attendance: "attendance.view", expense: "expenses.edit" };

// Home's + (the user's design): Add Member, Add Plan, Add Enquiry, Add Expense, Add Outlet, Add
// Staff / Admin Login (the gym admin only: canManageTeam), Send Bulk SMS, Attendance. A Staff
// login sees only the items of the areas the gym admin gave them.
export function AddSheet({ onClose, onPick, canManageTeam }: { onClose: () => void; onPick: (action: AddAction) => void; canManageTeam: boolean }) {
  const colors = useThemeColors();
  const can = useCan();
  const allowed = (item: (typeof ADD_SHEET)[number]) => (item.id !== "staff" || canManageTeam) && (!AREA_FOR[item.id] || can(AREA_FOR[item.id]!));
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
      <View>{ADD_SHEET.filter(allowed).map(row)}</View>
    </GymSheet>
  );
}
