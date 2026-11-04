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

// Plans / Catalogue › Add Plan (the user's design): a bottom sheet with the name, for a plan its
// Duration Type (Months or Days) and Duration, and the amount. Editing an item opens the same sheet
// with Delete. Saving first asks to confirm the details (Edit or Confirm), then calls back with
// the branch's updated list.
export function CatalogSheet({ kind, item, onClose, onSaved }: { kind: CatalogKind; item: CatalogItem | null; onClose: () => void; onSaved: (items: CatalogItem[]) => void }) {
  const colors = useThemeColors();
  const meta = CATALOG_KINDS.find((k) => k.id === kind)!;
  const isPlan = kind === "plan";
  const [name, setName] = useState(item?.name ?? "");
  const [unit, setUnit] = useState<PlanUnit>(item?.unit ?? "months");
  const [duration, setDuration] = useState(item?.duration ? String(item.duration) : "");
  const [price, setPrice] = useState(item ? String(item.price) : "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { busy, error, save } = useGymSave((data: { items: CatalogItem[] }) => onSaved(data.items));

  const length = durationValue(duration, unit);
  const amount = rupeesFromText(price);
  const ready = name.trim().length >= 2 && amount >= 1 && (!isPlan || length !== null);
  const title = `${item ? "Edit" : "Add"} ${TITLE[kind]}`;

  const submit = () => {
    setConfirming(false);
    save((token) => {
      const fields = { name: name.trim(), price: amount, ...(isPlan && length !== null ? { duration: length, unit } : {}) };
      return item ? gymApi.editItem(token, item.id, fields) : gymApi.addItem(token, { kind, ...fields });
    });
  };
  const rows: [string, string][] = [["Name", name.trim()], ...(isPlan && length !== null ? [["Duration", planLabel(length, unit)] as [string, string]] : []), ["Amount", rupees(amount)]];

  return (
    <GymSheet
      title={title}
      subtitle={`${item ? "Change" : "Add"} a ${meta.noun} for the outlet.`}
      onClose={onClose}
      overlay={confirming ? <ConfirmDialog rows={rows} onEdit={() => setConfirming(false)} onConfirm={submit} /> : null}
    >
      <GymField label={`${TITLE[kind]} name`} icon={{ ios: "arrowtriangle.right.fill", android: "arrow_right", web: "arrow_right" }} value={name} onChangeText={setName} maxLength={80} placeholder={`${TITLE[kind]} Name (Eg. ${isPlan ? "6 Months" : meta.example})`} />
      {isPlan && <PlanLengthFields unit={unit} onUnit={setUnit} duration={duration} onDuration={setDuration} />}
      <GymField label={`${TITLE[kind]} amount`} icon={{ ios: "banknote", android: "payments", web: "payments" }} value={price} onChangeText={(t) => setPrice(amountInput(t))} keyboardType="number-pad" placeholder={`${TITLE[kind]} Amount (Eg. 500)`} />
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
