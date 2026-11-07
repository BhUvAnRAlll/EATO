import { useState } from "react";
import { Text, View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { ReceiptViewer } from "@/components/gym/ReceiptViewer";
import { KIND_LABEL, METHOD_LABEL, initialsOf, rupees, shortDate } from "@/data/gymDashboard";
import type { GymPayment } from "@/lib/gymApi";
import { useThemeColors } from "@/theme";

// One payment: the member's initials (or an item icon for a shop sale), what it was, its type and
// method, and the amount with its day. Tapping a member's payment opens the member. A payment with
// a bill attached (Add Member › Attach the payment bill) has a Bill chip that opens the photo.
export function PaymentRow({ payment, onPress }: { payment: GymPayment; onPress?: () => void }) {
  const colors = useThemeColors();
  const [viewing, setViewing] = useState(false);
  const cash = payment.method === "cash";
  const label = `${payment.title}, ${payment.detail}${payment.kind !== "sale" ? `, ${KIND_LABEL[payment.kind]}` : ""}, ${METHOD_LABEL[payment.method]}, plus ${rupees(payment.amount)}, ${shortDate(payment.paidOn)}`;
  return (
    <PressableScale onPress={onPress} disabled={!onPress} className="gym-card gym-tx" accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={label}>
      {payment.kind === "sale" ? (
        <View className="gym-avatar gym-avatar--item">
          <GymIcon name="dumbbell" size={18} color={colors.gymSuccess} />
        </View>
      ) : (
        <View className="gym-avatar">
          <Text className="gym-avatar__label">{initialsOf(payment.title)}</Text>
        </View>
      )}
      <View className="min-w-0 flex-1" style={{ gap: 3 }}>
        <Text className="gym-tx__name" numberOfLines={1}>{payment.title}</Text>
        <View className="flex-row flex-wrap items-center" style={{ gap: 6 }}>
          <Text className="gym-tx__meta" numberOfLines={1}>{payment.detail}</Text>
          {payment.kind !== "sale" && (
            <View className="gym-chip" style={{ backgroundColor: colors.gymPrimarySoft, borderColor: colors.gymPrimaryLine }}>
              <Text className="gym-chip__label" style={{ color: colors.gymPrimaryText }}>{KIND_LABEL[payment.kind]}</Text>
            </View>
          )}
          <View className="gym-chip" style={cash ? { backgroundColor: colors.gymSuccessSoft, borderColor: colors.gymSuccessLine } : { backgroundColor: colors.gymPage, borderColor: colors.gymLine }}>
            <Text className="gym-chip__label" style={{ color: cash ? colors.gymSuccess : colors.gymInkSoft }}>{METHOD_LABEL[payment.method]}</Text>
          </View>
          {payment.receiptUrl && (
            <PressableScale onPress={() => setViewing(true)} className="gym-chip flex-row items-center" style={{ gap: 4, backgroundColor: colors.gymPrimarySoft, borderColor: colors.gymPrimaryLine }} accessibilityRole="button" accessibilityLabel="View the payment bill">
              <GymIcon name="receipt-text" size={12} color={colors.gymPrimaryText} />
              <Text className="gym-chip__label" style={{ color: colors.gymPrimaryText }}>Bill</Text>
            </PressableScale>
          )}
        </View>
      </View>
      <View className="items-end" style={{ gap: 3 }}>
        <Text className="gym-tx__amount">{`+${rupees(payment.amount)}`}</Text>
        <Text className="gym-tx__date">{shortDate(payment.paidOn)}</Text>
      </View>
      {viewing && payment.receiptUrl && <ReceiptViewer url={payment.receiptUrl} title={`${payment.title} · ${payment.detail}`} onClose={() => setViewing(false)} />}
    </PressableScale>
  );
}
