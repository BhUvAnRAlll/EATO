import { useCallback, useState } from "react";
import { Platform, Text, View } from "react-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymScreen } from "@/components/gym/GymScreen";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { WhatsAppMark } from "@/components/gym/WhatsAppMark";
import type { GymIconName } from "@/constants/gymIcons";
import { emailTo, smsPhone, whatsappPhone } from "@/lib/gymContact";
import { gymApi, type GymInvoice } from "@/lib/gymApi";
import { METHOD_WORD, detailRows, dueDate, gymInitials, invoiceDate, invoiceFileName, invoiceHtml, invoicePhone, invoiceRupees, invoiceSubtitle, invoiceText, itemDescription, safeLogo, type InvoiceRow } from "@/lib/gymInvoice";
import { haptic } from "@/lib/haptics";
import { NEEDS_NEW_BUILD, hasNativeModule } from "@/lib/nativeModules";
import { useGymData } from "@/lib/useGymData";
import { fonts } from "@/constants/fonts";
import { useThemeColors } from "@/theme";
import { useResponsive } from "@/lib/responsive";

// Gym admin › Invoice (2026-11-07, the user's request; the user's template since 2026-11-08): one
// payment's invoice as a sheet of paper on the canvas, laid out like the template, stacked for a
// phone: "Invoice" with a red rule and the kind, the gym's own logo at the top right (its initials
// when it has none), the number and dates, Member Details and Plan Details, the item table with a
// red header, the totals with the Total Amount on a pink band, Payment Details with a Paid badge,
// the signature line and the gym's footer bar. The same helpers (lib/gymInvoice.ts) lay out the
// PDF. Opened with ?paymentId= (a payment's Invoice chip) or ?memberId= (the ⋯ sheet's Send
// Invoice, Add Member, Collect Due and the sales sheets: the member's latest payment). Share PDF
// makes the PDF on the phone (expo-print) and hands it to the share sheet; WhatsApp, SMS and Email
// open the phone's own apps with the invoice as text. justFit sends nothing itself.
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

const LABEL_WIDTH = 104;

function Invoice({ invoice }: { invoice: GymInvoice }) {
  const colors = useThemeColors();
  // On a compact screen each label sits above its value, so a long name or a phone number keeps
  // the card's width instead of breaking mid-word beside the label column (2026-11-08, 320 wide)
  const { compact } = useResponsive();
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState("");
  const text = invoiceText(invoice);
  const phone = invoice.billTo?.phone ?? null;
  const email = invoice.billTo?.email ?? null;
  const cards = detailRows(invoice);
  const logo = safeLogo(invoice.gym.logoDataUrl);

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
    // expo-print is loaded only here, and only when this build has it: an app built before it was
    // added would otherwise crash the whole screen on opening (lib/nativeModules.ts)
    if (!hasNativeModule("ExpoPrint")) {
      setError(NEEDS_NEW_BUILD);
      return;
    }
    setSharing(true);
    try {
      const Print = await import("expo-print");
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

  // "Label : value", the template's three columns
  // A phone number never breaks across lines (no-break spaces)
  const kv = ([label, raw]: InvoiceRow) => {
    const value = label === "Phone" ? raw.replace(/ /g, "\u00A0") : raw;
    return compact ? (
    <View key={label} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text className="gym-tx__meta" style={{ fontSize: 12, lineHeight: 17, color: colors.muted }}>{label}</Text>
      <Text className="gym-tx__name" style={{ fontSize: 13, lineHeight: 19, fontFamily: fonts.medium }}>{value}</Text>
    </View>
  ) : (
    <View key={label} className="flex-row" style={{ gap: 8 }} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text className="gym-tx__meta" style={{ width: LABEL_WIDTH, fontSize: 13, lineHeight: 19, color: colors.ink }}>{label}</Text>
      <Text className="gym-tx__meta" style={{ fontSize: 13, lineHeight: 19, color: colors.ink }}>:</Text>
      <Text className="gym-tx__name min-w-0 flex-1" style={{ fontSize: 13, lineHeight: 19, fontFamily: fonts.medium }}>{value}</Text>
    </View>
  );
  };
  // A bordered card with a red icon and title, as the template draws Member, Plan and Payment Details
  const card = (icon: GymIconName, title: string, children: React.ReactNode) => (
    <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14, gap: 8 }}>
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <GymIcon name={icon} size={18} color={colors.primary} />
        <Text style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 21, color: colors.primary }} accessibilityRole="header">{title}</Text>
      </View>
      <View style={{ gap: 4 }}>{children}</View>
    </View>
  );
  const sendVia = (label: string, icon: "whatsapp" | "message-square" | "mail", onPress: () => void) => (
    <PressableScale onPress={onPress} className="gym-btn gym-btn--outline flex-1 flex-row items-center justify-center" style={{ gap: 8, minHeight: 48 }} accessibilityRole="button" accessibilityLabel={`${label} the invoice`}>
      {icon === "whatsapp" ? <WhatsAppMark size={20} /> : <GymIcon name={icon} size={18} color={colors.gymPrimaryText} />}
      <Text className="gym-btn__label gym-btn__label--outline">{label}</Text>
    </PressableScale>
  );
  const footLine = (icon: GymIconName, lines: string[]) => (
    <View key={lines[0]} className="flex-row" style={{ gap: 10 }}>
      <GymIcon name={icon} size={18} color={colors.primary} />
      <View className="min-w-0 flex-1">
        {lines.map((line, i) => <Text key={line} className={i === 0 ? "gym-tx__name" : "gym-tx__meta"} style={i === 0 ? { fontSize: 13, lineHeight: 19 } : undefined}>{line}</Text>)}
      </View>
    </View>
  );
  const amount = invoiceRupees(invoice.amount);

  return (
    <>
      <View className="gym-card" style={{ padding: 16, gap: 16, backgroundColor: colors.surface }} accessible={false}>
        {/* The heading and, at the top right, the gym's logo */}
        <View className="flex-row items-start justify-between" style={{ gap: 12 }}>
          <View className="min-w-0 flex-1" style={{ gap: 6 }}>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 28, lineHeight: 34, color: colors.ink }} accessibilityRole="header">Invoice</Text>
            <View style={{ width: 56, height: 3, borderRadius: 2, backgroundColor: colors.primary }} />
            <Text className="gym-tx__name" style={{ fontSize: 14, lineHeight: 20 }}>{invoiceSubtitle(invoice.item.kind)}</Text>
          </View>
          {logo ? (
            <View style={{ width: 104, height: 52 }} accessible accessibilityRole="image" accessibilityLabel={`${invoice.gym.name} logo`}>
              <Image source={{ uri: logo }} contentFit="contain" style={{ width: 104, height: 52 }} accessibilityIgnoresInvertColors />
            </View>
          ) : (
            <View style={{ width: 52, height: 52, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }} accessible accessibilityLabel={`${invoice.gym.name}, no logo yet`}>
              <Text style={{ fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26, color: colors.onPrimary }}>{gymInitials(invoice.gym.name)}</Text>
            </View>
          )}
        </View>
        <View style={{ gap: 4 }}>
          {kv(["Invoice No", invoice.number])}
          {kv(["Invoice Date", invoiceDate(invoice.date)])}
          {kv(["Due Date", invoiceDate(dueDate(invoice))])}
        </View>

        {card("user", cards.member.title, cards.member.rows.map(kv))}
        {card("calendar", cards.plan.title, cards.plan.rows.map(kv))}

        {/* The item table */}
        <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 12, overflow: "hidden" }} accessible accessibilityLabel={`Item 1, ${itemDescription(invoice)}, ${amount}`}>
          <View className="flex-row items-center" style={{ backgroundColor: colors.primary, paddingVertical: 10, paddingHorizontal: 12, gap: 10 }}>
            <Text style={{ width: 20, fontFamily: fonts.semibold, fontSize: 13, color: colors.onPrimary, textAlign: "center" }}>#</Text>
            <Text className="min-w-0 flex-1" style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.onPrimary }}>Description</Text>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.onPrimary }}>Amount</Text>
          </View>
          <View className="flex-row items-start" style={{ paddingVertical: 10, paddingHorizontal: 12, gap: 10 }}>
            <Text style={{ width: 20, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink, textAlign: "center" }}>1</Text>
            <Text className="min-w-0 flex-1" style={{ fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink }}>{itemDescription(invoice)}</Text>
            <Text style={{ fontFamily: fonts.medium, fontSize: 13, lineHeight: 19, color: colors.ink }}>{amount}</Text>
          </View>
        </View>

        {/* The totals: Subtotal, the Total Amount band, then what is still owed */}
        <View style={{ gap: 8 }}>
          <View className="flex-row items-center justify-between" style={{ paddingHorizontal: 12, paddingVertical: 4 }} accessible accessibilityLabel={`Subtotal ${amount}`}>
            <Text className="gym-confirm__label">Subtotal</Text>
            <Text className="gym-confirm__value" style={{ fontSize: 15 }}>{amount}</Text>
          </View>
          <View className="flex-row items-center justify-between" style={{ backgroundColor: colors.accentSoft, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 }} accessible accessibilityLabel={`Total Amount ${amount}`}>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 17, lineHeight: 23, color: colors.primary }}>Total Amount</Text>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 19, lineHeight: 25, color: colors.primary }}>{amount}</Text>
          </View>
          {invoice.balance ? (
            <View className="flex-row items-center justify-between" style={{ paddingHorizontal: 12, paddingVertical: 4, gap: 12 }} accessible accessibilityLabel={`Balance Due ${invoiceRupees(invoice.balance.due)}${invoice.balance.dueBy ? ` by ${invoiceDate(invoice.balance.dueBy)}` : ""}`}>
              {/* The date on a line of its own, kept whole ("by 15 Jan 2027" wrapped at 320) */}
              <View className="min-w-0 flex-1">
                <Text className="gym-confirm__label" style={{ color: colors.danger, fontFamily: fonts.medium }}>Balance Due</Text>
                {invoice.balance.dueBy ? <Text style={{ color: colors.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 }} numberOfLines={1}>{`by\u00A0${invoiceDate(invoice.balance.dueBy).replace(/ /g, "\u00A0")}`}</Text> : null}
              </View>
              <Text className="gym-confirm__value" style={{ fontSize: 15, color: colors.danger }}>{invoiceRupees(invoice.balance.due)}</Text>
            </View>
          ) : (
            <View className="flex-row items-center justify-between" style={{ paddingHorizontal: 12, paddingVertical: 4 }} accessible accessibilityLabel="Balance Due: Nil, paid in full">
              <Text className="gym-confirm__label" style={{ color: colors.success, fontFamily: fonts.medium }}>Balance Due</Text>
              <Text className="gym-confirm__value" style={{ fontSize: 15, color: colors.success }}>Nil · Paid in full</Text>
            </View>
          )}
        </View>

        {card("credit-card", "Payment Details", (
          <>
            {kv(["Payment Mode", METHOD_WORD[invoice.method]])}
            {kv(["Payment Date", invoiceDate(invoice.date)])}
            {/* "Status": "Payment Status" wrapped in the label column and broke the colons' line */}
            <View className="flex-row items-center" style={{ gap: 8 }} accessible accessibilityLabel="Payment Status: Paid">
              <Text className="gym-tx__meta" style={{ width: compact ? undefined : LABEL_WIDTH, fontSize: 13, lineHeight: 19, color: compact ? colors.muted : colors.ink }}>Status</Text>
              {!compact && <Text className="gym-tx__meta" style={{ fontSize: 13, lineHeight: 19, color: colors.ink }}>:</Text>}
              <View className="flex-row items-center" style={{ gap: 4, backgroundColor: colors.success, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 }}>
                <GymIcon name="check" size={12} color={colors.onPrimary} />
                <Text style={{ fontFamily: fonts.semibold, fontSize: 12, lineHeight: 18, color: colors.onPrimary }}>Paid</Text>
              </View>
            </View>
          </>
        ))}

        {/* The signature line */}
        <View className="items-end">
          <View className="items-center" style={{ width: 180, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.lineStrong }}>
            <Text className="gym-tx__name" style={{ fontSize: 13, lineHeight: 19 }}>Authorized Signature</Text>
            <Text className="gym-tx__meta">{invoice.gym.name}</Text>
          </View>
        </View>

        {/* The gym's footer bar */}
        <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 12, gap: 10 }}>
          {footLine("map-pin", [invoice.gym.name, `${invoice.gym.branch} · ${invoice.gym.area}, ${invoice.gym.city}`, ...(invoice.gym.address ? [invoice.gym.address] : [])])}
          {invoice.gym.phone ? footLine("phone", [invoicePhone(invoice.gym.phone)]) : null}
          {invoice.gym.gstin ? footLine("file-text", [`GSTIN ${invoice.gym.gstin}`]) : null}
        </View>
        <Text className="gym-tx__date" style={{ textAlign: "center" }}>{`Thank you for training with ${invoice.gym.name}. Made with justFit.`}</Text>
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
