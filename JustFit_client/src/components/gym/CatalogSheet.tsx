import { useState } from "react";
import { Text } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { ConfirmDialog } from "@/components/gym/ConfirmDialog";
import { GymField, amountInput, rupeesFromText } from "@/components/gym/GymField";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymSheet } from "@/components/gym/GymSheet";
import { PlanLengthFields, durationValue } from "@/components/gym/PlanLengthFields";
import { CATALOG_KINDS, planLabel, rupees } from "@/data/gymDashboard";
import { gymApi, type CatalogItem, type CatalogKind, type PlanUnit } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { useThemeColors } from "@/theme";

const TITLE: Record<CatalogKind, string> = { plan: "Plan", pt: "PT Package", service: "Service", product: "Product" };

// Plans / Catalogue › Add Plan (the user's design): a bottom sheet with the name, for a plan or a
// PT package its Duration Type (Months or Days) and Duration, the amount, and for a product how
// many are in stock (optional: left empty, stock isn't counted). Editing an item opens the same sheet
// with Delete. Saving first asks to confirm the details (Edit or Confirm), then calls back with
// the branch's updated list.
export function CatalogSheet({ kind, item, onClose, onSaved }: { kind: CatalogKind; item: CatalogItem | null; onClose: () => void; onSaved: (items: CatalogItem[]) => void }) {
  const colors = useThemeColors();
  const meta = CATALOG_KINDS.find((k) => k.id === kind)!;
  // Plans and PT packages have a length; products a stock count
  const isPlan = kind === "plan" || kind === "pt";
  const isProduct = kind === "product";
  const [name, setName] = useState(item?.name ?? "");
  const [unit, setUnit] = useState<PlanUnit>(item?.unit ?? "months");
  const [duration, setDuration] = useState(item?.duration ? String(item.duration) : "");
  const [price, setPrice] = useState(item ? String(item.price) : "");
  const [stock, setStock] = useState(item?.stock !== null && item?.stock !== undefined ? String(item.stock) : "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { busy, error, save } = useGymSave((data: { items: CatalogItem[] }) => onSaved(data.items));

  const length = durationValue(duration, unit);
  const amount = rupeesFromText(price);
  const stockValue = stock === "" ? null : Number(stock);
  const ready = name.trim().length >= 2 && amount >= 1 && (!isPlan || length !== null) && (stockValue === null || stockValue <= 100000);
  const title = `${item ? "Edit" : "Add"} ${TITLE[kind]}`;

  const submit = () => {
    setConfirming(false);
    save((token) => {
      const fields = {
        name: name.trim(),
        price: amount,
        ...(isPlan && length !== null ? { duration: length, unit } : {}),
        // Cleared on an edit: no longer counted
        ...(isProduct && (stockValue !== null || item) ? { stock: stockValue ?? ("" as const) } : {}),
      };
      return item ? gymApi.editItem(token, item.id, fields) : gymApi.addItem(token, { kind, ...fields });
    });
  };
  const rows: [string, string][] = [["Name", name.trim()], ...(isPlan && length !== null ? [["Duration", planLabel(length, unit)] as [string, string]] : []), ["Amount", rupees(amount)], ...(isProduct ? [["Stock", stockValue === null ? "Not counted" : `${stockValue} in stock`] as [string, string]] : [])];

  return (
    <GymSheet
      title={title}
      subtitle={`${item ? "Change" : "Add"} a ${meta.noun} for the outlet.`}
      onClose={onClose}
      overlay={confirming ? <ConfirmDialog rows={rows} onEdit={() => setConfirming(false)} onConfirm={submit} /> : null}
    >
      <GymField label={`${TITLE[kind]} name`} icon={{ ios: "arrowtriangle.right.fill", android: "arrow_right", web: "arrow_right" }} value={name} onChangeText={setName} maxLength={80} placeholder={`${TITLE[kind]} Name (Eg. ${kind === "plan" ? "6 Months" : meta.example})`} />
      {isPlan && <PlanLengthFields unit={unit} onUnit={setUnit} duration={duration} onDuration={setDuration} />}
      <GymField label={`${TITLE[kind]} amount`} icon={{ ios: "banknote", android: "payments", web: "payments" }} value={price} onChangeText={(t) => setPrice(amountInput(t))} keyboardType="number-pad" placeholder={`${TITLE[kind]} Amount (Eg. 500)`} />
      {isProduct && (
        <GymField label="In stock" icon={{ ios: "archivebox", android: "inventory_2", web: "inventory_2" }} value={stock} onChangeText={(t) => setStock(t.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" placeholder="In Stock (Eg. 20, optional)" hint={stockValue !== null && stockValue > 100000 ? "Up to 1,00,000." : "Selling to a member takes them out of stock."} />
      )}
      {error ? <FormAlert message={error} /> : null}
      <GymPrimaryButton label={item ? "Save changes" : title} ready={ready} busy={busy} onPress={() => setConfirming(true)} />
      {item &&
        (confirmDelete ? (
          <PressableScale onPress={() => save((token) => gymApi.deleteItem(token, item.id))} disabled={busy} className="gym-btn gym-btn--outline" style={{ borderColor: colors.gymDanger }} accessibilityRole="button" accessibilityLabel={`Yes, delete ${item.name}`}>
            <Text className="gym-btn__label" style={{ color: colors.gymDanger }}>Yes, delete it</Text>
          </PressableScale>
        ) : (
          <PressableScale onPress={() => setConfirmDelete(true)} className="self-center" hitSlop={10} accessibilityRole="button" accessibilityLabel={`Delete ${item.name}`}>
            <Text className="gym-tx__meta" style={{ color: colors.gymDanger }}>{`Delete this ${meta.noun}`}</Text>
          </PressableScale>
        ))}
    </GymSheet>
  );
}
