import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { ReceiptViewer } from "@/components/gym/ReceiptViewer";
import { KIND_LABEL, METHOD_LABEL, initialsOf, rupees, shortDate } from "@/data/gymDashboard";
import type { GymPayment } from "@/lib/gymApi";
import { useThemeColors } from "@/theme";

// One payment: the member's initials (or an item icon for a shop sale), what it was, its type and
// method, and the amount with its day. Tapping a member's payment opens the member. A payment with
// a bill attached (Add Member › Attach the payment bill) has a Bill chip that opens the photo, and
// with `invoice` (the member's page, Transactions) an Invoice chip opens the payment's invoice.
// The chips are buttons of their own on a line under the row, never inside the row's button: a
// button inside a button renders nested <button>s on the web, and the bill viewer's taps reached
// the row's onPress (QA 2026-11-07).
export function PaymentRow({ payment, onPress, invoice = false }: { payment: GymPayment; onPress?: () => void; invoice?: boolean }) {
  const colors = useThemeColors();
  const [viewing, setViewing] = useState(false);
  const cash = payment.method === "cash";
  const label = `${payment.title}, ${payment.detail}${payment.kind !== "sale" ? `, ${KIND_LABEL[payment.kind]}` : ""}, ${METHOD_LABEL[payment.method]}, plus ${rupees(payment.amount)}, ${shortDate(payment.paidOn)}`;
  const chips = invoice || Boolean(payment.receiptUrl);
  const chipStyle = { gap: 4, backgroundColor: colors.gymPrimarySoft, borderColor: colors.gymPrimaryLine };
  const Row = onPress ? PressableScale : View;
  return (
    <View className="gym-card" style={{ paddingHorizontal: 14, paddingVertical: 12, gap: chips ? 8 : 0 }}>
      <Row onPress={onPress} className="flex-row items-center" style={{ gap: 12 }} accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={label}>
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
          {/* The detail on its own line, then the type and the mode side by side (they used to
              wrap onto three lines at 360 wide with a larger text size, 2026-11-08) */}
          <Text className="gym-tx__meta" numberOfLines={1}>{payment.detail}</Text>
          <View className="flex-row items-center" style={{ gap: 6 }}>
            {payment.kind !== "sale" && (
              <View className="gym-chip" style={{ backgroundColor: colors.gymPrimarySoft, borderColor: colors.gymPrimaryLine }}>
                <Text className="gym-chip__label" style={{ color: colors.gymPrimaryText }}>{KIND_LABEL[payment.kind]}</Text>
              </View>
            )}
            <View className="gym-chip" style={cash ? { backgroundColor: colors.gymSuccessSoft, borderColor: colors.gymSuccessLine } : { backgroundColor: colors.gymPage, borderColor: colors.gymLine }}>
              <Text className="gym-chip__label" style={{ color: cash ? colors.gymSuccess : colors.gymInkSoft }}>{METHOD_LABEL[payment.method]}</Text>
            </View>
          </View>
        </View>
        <View className="items-end" style={{ gap: 3 }}>
          <Text className="gym-tx__amount">{`+${rupees(payment.amount)}`}</Text>
          <Text className="gym-tx__date">{shortDate(payment.paidOn)}</Text>
        </View>
      </Row>
      {chips && (
        <View className="flex-row items-center" style={{ gap: 8, paddingLeft: 56 }}>
          {invoice && (
            <PressableScale onPress={() => router.push({ pathname: "/gym/invoice", params: { paymentId: String(payment.id) } })} hitSlop={8} className="gym-chip flex-row items-center" style={chipStyle} accessibilityRole="button" accessibilityLabel={`Invoice for ${payment.title}, ${payment.detail}`}>
              <GymIcon name="file-text" size={12} color={colors.gymPrimaryText} />
              <Text className="gym-chip__label" style={{ color: colors.gymPrimaryText }}>Invoice</Text>
            </PressableScale>
          )}
          {payment.receiptUrl && (
            <PressableScale onPress={() => setViewing(true)} hitSlop={8} className="gym-chip flex-row items-center" style={chipStyle} accessibilityRole="button" accessibilityLabel="View the payment bill">
              <GymIcon name="receipt-text" size={12} color={colors.gymPrimaryText} />
              <Text className="gym-chip__label" style={{ color: colors.gymPrimaryText }}>Bill</Text>
            </PressableScale>
          )}
        </View>
      )}
      {viewing && payment.receiptUrl && <ReceiptViewer url={payment.receiptUrl} title={`${payment.title} · ${payment.detail}`} onClose={() => setViewing(false)} />}
    </View>
  );
}
