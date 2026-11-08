import { useCallback, useState } from "react";
import { Platform, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { GradientFill } from "@/components/gym/GradientFill";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymScreen } from "@/components/gym/GymScreen";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { WhatsAppMark } from "@/components/gym/WhatsAppMark";
import { emailTo, smsPhone, whatsappPhone } from "@/lib/gymContact";
import { gymApi, type GymInvoice } from "@/lib/gymApi";
import { METHOD_WORD, gymLines, invoiceDate, invoiceFileName, invoiceHtml, invoicePhone, invoiceRupees, invoiceText } from "@/lib/gymInvoice";
import { haptic } from "@/lib/haptics";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

// Gym admin › Invoice (2026-11-07, the user's request): one payment's invoice as a sheet of paper
// on the canvas: the gym on the portal's gradient with the number and date, Bill to, the one item,
// what was paid and the balance, then the membership's standing and the gym's invoice details.
// Opened with ?paymentId= (a payment's Invoice chip) or ?memberId= (the ⋯ sheet's Send Invoice,
// Add Member, Collect Due and the sales sheets: the member's latest payment). Share PDF makes the
// PDF on the phone (expo-print) and hands it to the share sheet; WhatsApp, SMS and Email open the
// phone's own apps with the invoice as text. justFit sends nothing itself.
export default function GymInvoiceScreen() {
  const params = useLocalSearchParams<{ paymentId?: string; memberId?: string }>();
  const paymentId = Number(params.paymentId) || 0;
  const memberId = Number(params.memberId) || 0;
  const load = useCallback((token: string | null) => (paymentId ? gymApi.invoice(token, paymentId) : gymApi.memberInvoice(token, memberId)), [paymentId, memberId]);
  const { result, retry } = useGymData(load);
  return (
    <GymScreen title="Invoice">
      {result.state === "loading" && <GymLoading label="Preparing the invoice" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
      {result.state === "ready" && <Invoice invoice={result.data} />}
    </GymScreen>
  );
}

function Invoice({ invoice }: { invoice: GymInvoice }) {
  const colors = useThemeColors();
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState("");
  const text = invoiceText(invoice);
  const phone = invoice.billTo?.phone ?? null;
  const email = invoice.billTo?.email ?? null;

  const sharePdf = async () => {
    if (sharing) return;
    setError("");
    const html = invoiceHtml(invoice);
    if (Platform.OS === "web") {
      // The browser shows the invoice in a new tab; its own print dialog saves it as a PDF
      const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return;
    }
    setSharing(true);
    try {
      // An A4 page in points; the file is renamed after the invoice so the share sheet shows it
      const made = await Print.printToFileAsync({ html, width: 595, height: 842 });
      const target = new File(Paths.cache, invoiceFileName(invoice));
      if (target.exists) target.delete();
      await new File(made.uri).move(target);
      if (!(await Sharing.isAvailableAsync())) throw new Error("no sharing");
      await Sharing.shareAsync(target.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: invoice.number });
      haptic.success();
    } catch {
      setError("We couldn't make the PDF on this phone. Please try again.");
    }
    setSharing(false);
  };

  const row = (label: string, value: string, tone?: "danger" | "success") => (
    <View className="flex-row items-center justify-between" style={{ gap: 12 }} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text className="gym-confirm__label">{label}</Text>
      <Text className="gym-confirm__value" style={tone === "danger" ? { color: colors.gymDanger } : tone === "success" ? { color: colors.gymSuccess } : undefined} numberOfLines={1}>{value}</Text>
    </View>
  );
  const sendVia = (label: string, icon: "whatsapp" | "message-square" | "mail", onPress: () => void) => (
    <PressableScale onPress={onPress} className="gym-btn gym-btn--outline flex-1 flex-row items-center justify-center" style={{ gap: 8, minHeight: 48 }} accessibilityRole="button" accessibilityLabel={`${label} the invoice`}>
      {icon === "whatsapp" ? <WhatsAppMark size={20} /> : <GymIcon name={icon} size={18} color={colors.gymPrimaryText} />}
      <Text className="gym-btn__label gym-btn__label--outline">{label}</Text>
    </PressableScale>
  );

  return (
    <>
      <View className="gym-card" style={{ overflow: "hidden" }} accessible={false}>
        {/* The gym on the gradient, with the invoice number and date */}
        <View style={{ padding: 20, gap: 12 }}>
          <GradientFill radius={0} />
          <View className="flex-row items-start justify-between" style={{ gap: 12 }}>
            <View className="min-w-0 flex-1" style={{ gap: 2 }}>
              <Text className="gym-hero__plan" style={{ fontSize: 20, lineHeight: 26 }} numberOfLines={1} accessibilityRole="header">{invoice.gym.name}</Text>
              {gymLines(invoice.gym).map((line) => <Text key={line} className="gym-hero__note" numberOfLines={2}>{line}</Text>)}
            </View>
            <View className="items-end" style={{ gap: 2 }}>
              <Text className="gym-hero__label">Invoice</Text>
              <Text className="gym-hero__plan" accessibilityLabel={`Invoice number ${invoice.number}`}>{invoice.number}</Text>
              <Text className="gym-hero__note">{invoiceDate(invoice.date)}</Text>
            </View>
          </View>
        </View>

        <View style={{ padding: 20, gap: 18 }}>
          <View style={{ gap: 4 }}>
            <Text className="gym-section-title">Bill to</Text>
            {invoice.billTo ? (
              <>
                <Text className="gym-tx__name">{invoice.billTo.name}</Text>
                <Text className="gym-tx__meta">{`Member ID ${invoice.billTo.code}${phone ? ` · ${invoicePhone(phone)}` : ""}`}</Text>
              </>
            ) : (
              <Text className="gym-tx__name">Walk-in customer</Text>
            )}
          </View>

          <View style={{ gap: 4 }}>
            <Text className="gym-section-title">Payment</Text>
            <View className="flex-row items-center justify-between" style={{ gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.gymLine }} accessible accessibilityLabel={`${invoice.item.label}, ${invoice.item.detail}, ${invoiceRupees(invoice.amount)}`}>
              <View className="min-w-0 flex-1" style={{ gap: 2 }}>
                <Text className="gym-tx__name" numberOfLines={1}>{invoice.item.label}</Text>
                <Text className="gym-tx__meta" numberOfLines={2}>{invoice.item.detail}</Text>
              </View>
              <Text className="gym-confirm__value">{invoiceRupees(invoice.amount)}</Text>
            </View>
            <View style={{ gap: 10, paddingTop: 10 }}>
              {row(`Paid · ${METHOD_WORD[invoice.method]}`, invoiceRupees(invoice.amount))}
              {invoice.balance
                ? row(`Balance due${invoice.balance.dueBy ? ` by ${invoiceDate(invoice.balance.dueBy)}` : ""}`, invoiceRupees(invoice.balance.due), "danger")
                : row("Balance due", "Nil · Paid in full", "success")}
            </View>
          </View>

          {invoice.membership && (
            <Text className="gym-tx__meta">
              {`Membership${invoice.membership.plan ? ` (${invoice.membership.plan})` : ""} ${invoice.membership.active ? "valid till" : "ended on"} ${invoiceDate(invoice.membership.until)}.`}
            </Text>
          )}
          <Text className="gym-tx__date">{`Thank you for training with ${invoice.gym.name}. Made with justFit.`}</Text>
        </View>
      </View>

      {error ? <FormAlert message={error} /> : null}
      <GymPrimaryButton label={sharing ? "Making the PDF…" : "Share PDF"} icon="share-2" ready={!sharing} busy={sharing} onPress={sharePdf} />
      <View className="flex-row" style={{ gap: 10 }}>
        {sendVia("WhatsApp", "whatsapp", () => whatsappPhone(phone, text))}
        {sendVia("SMS", "message-square", () => smsPhone(phone, text))}
        {email ? sendVia("Email", "mail", () => emailTo(email, `${invoice.gym.name} invoice ${invoice.number}`, text)) : null}
      </View>
      {invoice.billTo && (
        <PressableScale onPress={() => router.push({ pathname: "/gym/members/[id]", params: { id: String(invoice.billTo?.id) } })} className="self-center" style={{ minHeight: 44, justifyContent: "center" }} accessibilityRole="button" accessibilityLabel={`Open ${invoice.billTo.name}`}>
          <Text className="gym-link">{`Open ${invoice.billTo.name}`}</Text>
        </PressableScale>
      )}
    </>
  );
}
