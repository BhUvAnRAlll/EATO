import { useState } from "react";
import { Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { ChoiceChip } from "@/components/gym/GymChip";
import { ConfirmDialog } from "@/components/gym/ConfirmDialog";
import { DateSelect } from "@/components/gym/DateSelect";
import { ChipRow, METHODS } from "@/components/gym/GymChoice";
import { GymField, amountInput, rupeesFromText } from "@/components/gym/GymField";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymSheet } from "@/components/gym/GymSheet";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { EXPENSE_CATEGORIES, EXPENSE_LABEL, daysFromToday, rupees, shortDate, todayIso } from "@/data/gymDashboard";
import { gymApi, type ExpenseCategory, type ExpenseFields, type GymExpense, type PayMethod } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { pickReceiptImage, type MemberPhoto, type PhotoSource } from "@/lib/gymPhoto";
import { notice } from "@/lib/gymPortal";
import { haptic } from "@/lib/haptics";
import { useThemeColors } from "@/theme";

// Manage › Expense › + (also Home's + › Add Expense and ☰ › Expenses): what the money went on (a
// fixed list; Other needs a title), what it was, who was paid, the amount, cash or online, the day
// (a year back to today), a note and an optional photo of the bill. Saving asks to confirm the
// details first. Editing opens the same sheet filled in; the gym admin also sees Delete (asked
// twice). The bill is uploaded once the expense is saved; if only the bill fails, the expense stays
// saved and the sheet says so.
export function ExpenseSheet({ expense, canDelete, onClose, onSaved }: { expense: GymExpense | null; canDelete: boolean; onClose: () => void; onSaved: () => void }) {
  const colors = useThemeColors();
  const today = todayIso();
  const [category, setCategory] = useState<ExpenseCategory | null>(expense?.category ?? null);
  const [title, setTitle] = useState(expense?.title ?? "");
  const [paidTo, setPaidTo] = useState(expense?.paidTo ?? "");
  const [amountText, setAmountText] = useState(expense ? String(expense.amount) : "");
  const [method, setMethod] = useState<PayMethod | "">(expense?.method ?? "");
  const [spentOn, setSpentOn] = useState(expense?.spentOn ?? today);
  const [note, setNote] = useState(expense?.note ?? "");
  // null: the bill as it is; "remove": take the saved one off; a MemberPhoto: a new one to upload
  const [bill, setBill] = useState<MemberPhoto | "remove" | null>(null);
  const [billError, setBillError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { busy, error, save } = useGymSave(() => onSaved());

  const amount = rupeesFromText(amountText);
  const needsTitle = category === "other";
  const ready = category !== null && method !== "" && amount >= 1 && amount <= 1_000_000 && (!needsTitle || title.trim().length >= 2);
  const hasBill = bill === "remove" ? false : bill !== null || (expense?.billUrl ?? null) !== null;

  const chooseBill = async (source: PhotoSource) => {
    setBillError("");
    const picked = await pickReceiptImage(source).catch(() => ({ ok: false as const, error: "That photo couldn't be read. Please try another." }));
    if (picked.ok) setBill(picked.photo);
    else if ("error" in picked) setBillError(picked.error);
  };

  const submit = () => {
    setConfirming(false);
    if (!category || method === "") return;
    const fields: ExpenseFields = { category, title: title.trim(), paidTo: paidTo.trim(), method, amount, spentOn, note: note.trim() };
    save(async (token) => {
      const saved = expense ? await gymApi.editExpense(token, expense.id, fields) : await gymApi.addExpense(token, fields);
      if (!saved.ok || bill === null) return saved;
      const id = saved.data.expense.id;
      const withBill = bill === "remove" ? await gymApi.removeExpenseBill(token, id) : await gymApi.setExpenseBill(token, id, bill);
      if (withBill.ok) return withBill;
      notice("Expense saved", `The expense was saved, but the bill couldn't be ${bill === "remove" ? "removed" : "saved"}: ${withBill.error}`);
      return saved;
    });
  };

  const rows: [string, string][] = [
    ["Category", category ? EXPENSE_LABEL[category] : ""],
    ...(title.trim() ? [["For", title.trim()] as [string, string]] : []),
    ...(paidTo.trim() ? [["Paid to", paidTo.trim()] as [string, string]] : []),
    ["Amount", rupees(amount)],
    ["Mode", method === "cash" ? "Cash" : "Online"],
    ["Date", shortDate(spentOn)],
    ...(bill !== null || expense?.billUrl ? [["Bill", bill === "remove" ? "Removed" : bill ? "Added" : "Kept"] as [string, string]] : []),
  ];

  return (
    <GymSheet
      title={expense ? "Edit Expense" : "Add Expense"}
      subtitle={expense ? "Change what was spent." : "Record money the outlet spent."}
      onClose={onClose}
      overlay={confirming ? <ConfirmDialog rows={rows} onEdit={() => setConfirming(false)} onConfirm={submit} busy={busy} /> : null}
      onDismissOverlay={() => setConfirming(false)}
    >
      <View style={{ gap: 8 }}>
        <Text className="gym-field__label">Spent on</Text>
        <View className="flex-row flex-wrap" style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Spent on">
          {EXPENSE_CATEGORIES.map((c) => {
            const selected = c.id === category;
            return (
              <ChoiceChip
                key={c.id}
                onPress={() => { if (!selected) haptic.select(); setCategory(c.id); }}
                selected={selected}
                label={c.label}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <GymIcon name={c.icon} size={14} color={selected ? colors.white : colors.gymPrimary} />
              </ChoiceChip>
            );
          })}
        </View>
      </View>
      <GymField label={needsTitle ? "What it was for" : "What it was for (optional)"} icon="pencil-line" pinLabel value={title} onChangeText={setTitle} maxLength={80} placeholder={needsTitle ? "e.g. Water cans" : "e.g. November rent"} />
      <GymField label="Paid to (optional)" icon="user" pinLabel value={paidTo} onChangeText={setPaidTo} maxLength={80} placeholder="e.g. Landlord" />
      <GymField label="Amount" icon="banknote" value={amountText} onChangeText={(t) => setAmountText(amountInput(t))} keyboardType="number-pad" placeholder="Amount (Eg. 25000)" hint={amount > 1_000_000 ? "Up to ₹10,00,000." : undefined} />
      <ChipRow label="Mode" options={METHODS} value={method} onChange={(v) => setMethod(v)} />
      <DateSelect label="Date" value={spentOn} onChange={setSpentOn} min={daysFromToday(-365)} max={today} />
      <GymField label="Note (optional)" icon="notebook-pen" value={note} onChangeText={setNote} maxLength={200} placeholder="Note (optional)" multiline />
      <View style={{ gap: 8 }}>
        <Text className="gym-field__label">Bill photo (optional)</Text>
        <View className="gym-item-image" accessible accessibilityLabel={hasBill ? "Bill photo, chosen" : "Bill photo, none yet"}>
          <GymIcon name="receipt-text" size={28} color={colors.gymMuted} />
          <Text className="gym-item-image__hint">A photo of the bill or receipt</Text>
          {bill === "remove" ? null : bill ? <MemberPhotoImage uri={bill.previewUri} /> : <MemberPhotoImage url={expense?.billUrl} />}
        </View>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          <PressableScale onPress={() => chooseBill("camera")} className="gym-choice flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel={hasBill ? "Retake the bill photo" : "Take a photo of the bill"}>
            <GymIcon name="camera" size={16} color={colors.gymPrimary} />
            <Text className="gym-choice__label">{hasBill ? "Retake" : "Camera"}</Text>
          </PressableScale>
          <PressableScale onPress={() => chooseBill("library")} className="gym-choice flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Choose the bill from the gallery">
            <GymIcon name="image" size={16} color={colors.gymPrimary} />
            <Text className="gym-choice__label">Gallery</Text>
          </PressableScale>
          {hasBill && (
            <PressableScale onPress={() => { setBill(expense?.billUrl ? "remove" : null); setBillError(""); }} className="gym-choice flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Remove the bill photo">
              <GymIcon name="x" size={16} color={colors.gymPrimary} />
              <Text className="gym-choice__label">Remove</Text>
            </PressableScale>
          )}
        </View>
        {billError ? <Text className="gym-tx__meta" style={{ color: colors.gymDanger }}>{billError}</Text> : null}
      </View>
      {error ? <FormAlert message={error} /> : null}
      <GymPrimaryButton label={expense ? "Save changes" : "Add Expense"} ready={ready} busy={busy} onPress={() => setConfirming(true)} />
      {expense && canDelete &&
        (confirmDelete ? (
          <PressableScale onPress={() => save((token) => gymApi.deleteExpense(token, expense.id))} disabled={busy} className="gym-btn gym-btn--outline" style={{ borderColor: colors.gymDanger }} accessibilityRole="button" accessibilityLabel="Yes, delete this expense">
            <Text className="gym-btn__label" style={{ color: colors.gymDanger }}>Yes, delete it</Text>
          </PressableScale>
        ) : (
          <PressableScale onPress={() => setConfirmDelete(true)} className="self-center" hitSlop={10} accessibilityRole="button" accessibilityLabel="Delete this expense">
            <Text className="gym-tx__meta" style={{ color: colors.gymDanger }}>Delete this expense</Text>
          </PressableScale>
        ))}
    </GymSheet>
  );
}
