import { useState } from "react";
import { Text, View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymSheet } from "@/components/gym/GymSheet";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { ReceiptViewer } from "@/components/gym/ReceiptViewer";
import { EXPENSE_ICON, EXPENSE_LABEL, expenseTitle, rupees, shortDate } from "@/data/gymDashboard";
import type { GymExpense } from "@/lib/gymApi";
import { haptic } from "@/lib/haptics";
import { useThemeColors } from "@/theme";

// Manage › Expenses › a card (2026-11-08, the user's request): the expense on its own first, read
// only: what it was, the amount, the category, who was paid, cash or online, the day, the note and
// the bill (tap to see it whole). Edit opens the Edit sheet; Delete stays in there.
export function ExpenseDetailsSheet({ expense, onClose, onEdit }: { expense: GymExpense; onClose: () => void; onEdit?: () => void }) {
  const colors = useThemeColors();
  const [viewingBill, setViewingBill] = useState(false);
  const title = expenseTitle(expense);
  const rows: [string, string][] = [
    ["Category", EXPENSE_LABEL[expense.category]],
    ["Paid to", expense.paidTo ?? "—"],
    ["Mode", expense.method === "cash" ? "Cash" : "Online"],
    ["Date", shortDate(expense.spentOn)],
  ];

  return (
    <GymSheet onClose={onClose}>
      <View className="flex-row items-center" style={{ gap: 14 }}>
        <View className="gym-template__icon" style={{ width: 52, height: 52, borderRadius: 16 }}>
          <GymIcon name={EXPENSE_ICON[expense.category]} size={24} color={colors.gymPrimary} />
        </View>
        <View className="min-w-0 flex-1" style={{ gap: 2 }}>
          <Text className="gym-sheet__title" accessibilityRole="header" numberOfLines={2}>{title}</Text>
          <Text className="gym-sheet__subtitle">Expense details</Text>
        </View>
        <PressableScale onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close expense details">
          <GymIcon name="x" size={22} color={colors.gymInk} />
        </PressableScale>
      </View>

      <View className="gym-template__preview items-center" style={{ gap: 2, paddingVertical: 16 }} accessible accessibilityLabel={`Amount spent: ${rupees(expense.amount)}`}>
        <Text className="gym-tx__meta">Amount spent</Text>
        <Text className="gym-expense-detail__amount" style={{ color: colors.gymDanger }}>{`−${rupees(expense.amount)}`}</Text>
      </View>

      <View style={{ gap: 12 }}>
        {rows.map(([label, value]) => (
          <View key={label} className="flex-row items-center justify-between" style={{ gap: 12 }} accessible accessibilityLabel={`${label}: ${value}`}>
            <Text className="gym-confirm__label">{label}</Text>
            <Text className="gym-confirm__value" style={{ flexShrink: 1, textAlign: "right" }} numberOfLines={3}>{value}</Text>
          </View>
        ))}
      </View>

      {expense.note ? (
        <View style={{ gap: 6 }}>
          <Text className="gym-confirm__label">Note</Text>
          <View className="gym-template__preview">
            <Text className="gym-template__preview-text">{expense.note}</Text>
          </View>
        </View>
      ) : null}

      {expense.billUrl ? (
        <View style={{ gap: 6 }}>
          <Text className="gym-confirm__label">Bill</Text>
          <PressableScale onPress={() => { haptic.select(); setViewingBill(true); }} className="gym-item-image" accessibilityRole="button" accessibilityLabel={`View the bill for ${title}`}>
            <GymIcon name="receipt-text" size={28} color={colors.gymMuted} />
            <MemberPhotoImage url={expense.billUrl} fit="contain" />
          </PressableScale>
        </View>
      ) : null}

      {/* Left out for a login without Expenses › Add and edit expenses */}
      {onEdit && <GymPrimaryButton label="Edit Expense" icon="pencil-line" ready onPress={onEdit} />}

      {viewingBill && expense.billUrl && <ReceiptViewer url={expense.billUrl} title={`${title} · ${shortDate(expense.spentOn)}`} onClose={() => setViewingBill(false)} />}
    </GymSheet>
  );
}
