import { useCallback, useState } from "react";
import { Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { CatalogSheet } from "@/components/gym/CatalogSheet";
import { DateSelect } from "@/components/gym/DateSelect";
import { DueByField } from "@/components/gym/DueByField";
import { CheckRow, ChipRow, METHODS } from "@/components/gym/GymChoice";
import { GradientFill } from "@/components/gym/GradientFill";
import { GymField, amountInput, rupeesFromText } from "@/components/gym/GymField";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymSheet } from "@/components/gym/GymSheet";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { daysFromToday, rupees } from "@/data/gymDashboard";
import { invoice, whatsapp } from "@/lib/gymContact";
import { gymApi, type GymInfo, type GymMember, type GymMemberDetail, type PayMethod } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { haptic } from "@/lib/haptics";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

const MONEY = { ios: "banknote", android: "payments", web: "payments" } as const;
const COPY = {
  product: { title: "Sell Product", subtitle: "Sell a product to this member", list: "Available Products", add: "Add New Product" },
  service: { title: "Add Service", subtitle: "Add a service for this member", list: "Available Services", add: "Add New Service" },
};

// A member's ⋯ › Sell Product / Add Service (the GymOps designs): the payment date, the branch's
// products (or services) as chips, for a product the quantity beside what's in stock, a discount,
// the mode, Amount Payable and Due Amount, Amount Collected (the rest is owed by a date), Send
// Invoice. The server reads the price from the catalogue and takes products out of stock.
export function MemberSaleSheet({ kind, member, gym, onClose, onSaved }: { kind: "product" | "service"; member: GymMember; gym: GymInfo; onClose: () => void; onSaved: (detail: GymMemberDetail) => void }) {
  const colors = useThemeColors();
  const copy = COPY[kind];
  const isProduct = kind === "product";
  const load = useCallback((token: string | null) => gymApi.catalog(token), []);
  const { result: catalog, retry, set: setCatalog } = useGymData(load);
  const [paidOn, setPaidOn] = useState(daysFromToday(0));
  const [itemId, setItemId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [discount, setDiscount] = useState("0");
  const [method, setMethod] = useState<PayMethod | "">("online");
  const [collected, setCollected] = useState("");
  const [dueBy, setDueBy] = useState<string | null>(null);
  const [sendInvoice, setSendInvoice] = useState(false);
  const [adding, setAdding] = useState(false);
  const { busy, error, save } = useGymSave((detail: GymMemberDetail) => {
    if (sendInvoice) whatsapp(detail.member, invoice(detail.member, gym, detail.payments[0]));
    onSaved(detail);
  });

  const items = catalog.state === "ready" ? catalog.data.items.filter((i) => i.kind === kind) : [];
  const chosen = items.find((i) => i.id === itemId) ?? null;
  const count = isProduct ? Number.parseInt(quantity, 10) || 0 : 1;
  const total = chosen ? chosen.price * count : 0;
  const discountNum = rupeesFromText(discount) || 0;
  const payable = Math.max(total - discountNum, 0);
  const paidNum = rupeesFromText(collected) || 0;
  const due = Math.max(payable - paidNum, 0);

  // Each check in the order the form reads, with the line shown under its field
  const stockShort = isProduct && chosen?.stock != null && count > chosen.stock;
  const quantityHint = !isProduct ? undefined : count < 1 || count > 100 ? "1 to 100 at a time." : stockShort ? (chosen?.stock === 0 ? "Out of stock." : `Only ${chosen?.stock} in stock.`) : undefined;
  const discountHint = chosen && discountNum >= total ? "The discount must be less than the amount." : undefined;
  const collectedHint = paidNum > payable ? "Can't be more than the amount payable." : undefined;
  const ready = chosen !== null && !quantityHint && !discountHint && !collectedHint && paidNum >= 1 && method !== "" && (due === 0 || dueBy !== null);

  const submit = () =>
    save((token) =>
      gymApi.sellToMember(token, member.id, kind, {
        itemId: chosen!.id,
        ...(isProduct ? { quantity: count } : {}),
        discount: discountNum,
        paid: paidNum,
        method: method || "online",
        paidOn,
        ...(due > 0 && dueBy ? { dueBy } : {}),
      }),
    );

  return (
    <>
      <GymSheet title={copy.title} subtitle={copy.subtitle} onClose={onClose}>
        <DateSelect label="Payment Date" value={paidOn} onChange={setPaidOn} min={daysFromToday(-365)} max={daysFromToday(0)} stacked />
        {catalog.state === "loading" && <GymLoading label="Loading the catalogue" />}
        {catalog.state === "failed" && <GymError error={catalog.error} onRetry={retry} />}
        {catalog.state === "ready" && (
          <>
            <Text className="gym-field__label" style={{ fontSize: 14 }}>{`${copy.list} (${items.length})`}</Text>
            <View className="flex-row flex-wrap" style={{ gap: 8 }} accessibilityRole="radiogroup">
              {items.map((item) => {
                const selected = item.id === itemId;
                return (
                  <PressableScale key={item.id} onPress={() => { if (!selected) haptic.select(); setItemId(item.id); }} className={selected ? "gym-kind gym-kind--selected" : "gym-kind"} style={{ minHeight: 36, paddingHorizontal: 14 }} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${item.name}, ${rupees(item.price)}${item.stock === 0 ? ", out of stock" : ""}`}>
                    {selected && <GradientFill radius={999} />}
                    <Text className={selected ? "gym-kind__label gym-kind__label--selected" : "gym-kind__label"}>{item.name}</Text>
                  </PressableScale>
                );
              })}
              <PressableScale onPress={() => setAdding(true)} className="gym-choice flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel={copy.add}>
                <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={14} tintColor={colors.gymPrimary} />
                <Text className="gym-choice__label">{copy.add}</Text>
              </PressableScale>
            </View>
          </>
        )}
        {isProduct && (
          <View className="flex-row items-start" style={{ gap: 10 }}>
            <View className="min-w-0 flex-1">
              <GymField label="Quantity" icon={MONEY} value={quantity} onChangeText={(t) => setQuantity(t.replace(/\D/g, "").slice(0, 3))} keyboardType="number-pad" placeholder="Quantity" hint={quantityHint} />
            </View>
            <View className="min-w-0 flex-1">
              <GymField label="In stock" icon={{ ios: "archivebox", android: "inventory_2", web: "inventory_2" }} value={chosen ? (chosen.stock === null ? "Not counted" : String(chosen.stock)) : "-"} placeholder="In Stock" editable={false} style={{ color: colors.gymMuted }} />
            </View>
          </View>
        )}
        <GymField label="Discount amount" icon={MONEY} value={discount} onChangeText={(t) => setDiscount(amountInput(t))} keyboardType="number-pad" placeholder="Discount Amount" hint={discountHint} />
        <ChipRow label="Mode" options={METHODS} value={method} onChange={setMethod} />
        <View className="flex-row" style={{ gap: 12 }}>
          <View className="flex-1 items-center" style={{ gap: 6 }} accessible accessibilityLabel={`Amount payable ${rupees(payable)}`}>
            <Text className="gym-field__label" style={{ fontSize: 14 }}>Amount Payable</Text>
            <View className="gym-amount-box"><Text className="gym-amount-box__value">{rupees(payable)}</Text></View>
          </View>
          <View className="flex-1 items-center" style={{ gap: 6 }} accessible accessibilityLabel={`Due amount ${rupees(due)}`}>
            <Text className="gym-field__label" style={{ fontSize: 14 }}>Due Amount</Text>
            <View className="gym-amount-box"><Text className="gym-amount-box__value" style={{ color: due > 0 ? colors.gymDanger : colors.gymInk }}>{rupees(due)}</Text></View>
          </View>
        </View>
        <GymField label="Amount collected" icon={MONEY} value={collected} onChangeText={(t) => setCollected(amountInput(t))} keyboardType="number-pad" placeholder="Amount Collected" hint={collectedHint} />
        {chosen && paidNum >= 1 && due > 0 && <DueByField value={dueBy} onChange={setDueBy} label={`Pay the other ${rupees(due)} by`} />}
        <CheckRow label="Send Invoice" checked={sendInvoice} onChange={setSendInvoice} />
        {error ? <FormAlert message={error} /> : null}
        <GymPrimaryButton label={copy.title} ready={ready} busy={busy} onPress={submit} />
      </GymSheet>
      {adding && (
        <CatalogSheet
          kind={kind}
          item={null}
          onClose={() => setAdding(false)}
          onSaved={(updated) => {
            setCatalog({ items: updated });
            const added = updated.filter((i) => i.kind === kind).sort((a, b) => b.id - a.id)[0];
            if (added) setItemId(added.id);
            setAdding(false);
          }}
        />
      )}
    </>
  );
}
