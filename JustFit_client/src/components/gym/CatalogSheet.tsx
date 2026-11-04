import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, ReduceMotion, SlideInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FormAlert } from "@/components/FormAlert";
import { GradientFill } from "@/components/gym/GradientFill";
import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { GymField, amountInput, rupeesFromText } from "@/components/gym/GymField";
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
  const insets = useSafeAreaInsets();
  const meta = CATALOG_KINDS.find((k) => k.id === kind)!;
  const isPlan = kind === "plan";
  const [name, setName] = useState(item?.name ?? "");
  const [unit, setUnit] = useState<PlanUnit>(item?.unit ?? "months");
  const [duration, setDuration] = useState(item?.duration ? String(item.duration) : "");
  const [price, setPrice] = useState(item ? String(item.price) : "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  // "Please confirm the details" before saving
  const [confirming, setConfirming] = useState(false);
  const { busy, error, save } = useGymSave((data: { items: CatalogItem[] }) => onSaved(data.items));
  const saveAndClose = (send: Parameters<typeof save>[0]) => {
    setConfirming(false);
    save(send);
  };

  const length = durationValue(duration, unit);
  const amount = rupeesFromText(price);
  const ready = name.trim().length >= 2 && amount >= 1 && (!isPlan || length !== null);
  const title = `${item ? "Edit" : "Add"} ${TITLE[kind]}`;

  const submit = () =>
    saveAndClose((token) => {
      const fields = { name: name.trim(), price: amount, ...(isPlan && length !== null ? { duration: length, unit } : {}) };
      return item ? gymApi.editItem(token, item.id, fields) : gymApi.addItem(token, { kind, ...fields });
    });

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(160).reduceMotion(ReduceMotion.System)} style={{ flex: 1, backgroundColor: "rgba(17, 24, 39, 0.45)" }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Animated.View entering={SlideInDown.duration(260).reduceMotion(ReduceMotion.System)} className="gym-sheet" style={{ paddingBottom: insets.bottom + 20 }} accessibilityViewIsModal>
            <View className="gym-sheet__handle" />
            <ScrollView contentContainerStyle={{ gap: 16 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false}>
              <View className="flex-row items-start" style={{ gap: 12 }}>
                <View className="flex-1" style={{ gap: 2 }}>
                  <Text className="gym-sheet__title" accessibilityRole="header">{title}</Text>
                  <Text className="gym-sheet__subtitle">{`${item ? "Change" : "Add"} a ${meta.noun} for the outlet.`}</Text>
                </View>
                <PressableScale onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                  <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={22} tintColor={colors.gymInk} />
                </PressableScale>
              </View>
              <GymField label={`${TITLE[kind]} name`} icon={{ ios: "arrowtriangle.right.fill", android: "arrow_right", web: "arrow_right" }} value={name} onChangeText={setName} maxLength={80} placeholder={`${TITLE[kind]} Name (Eg. ${isPlan ? "6 Months" : meta.example})`} />
              {isPlan && <PlanLengthFields unit={unit} onUnit={setUnit} duration={duration} onDuration={setDuration} />}
              <GymField label={`${TITLE[kind]} amount`} icon={{ ios: "banknote", android: "payments", web: "payments" }} value={price} onChangeText={(t) => setPrice(amountInput(t))} keyboardType="number-pad" placeholder={`${TITLE[kind]} Amount (Eg. 500)`} />
              {error ? <FormAlert message={error} /> : null}
              <PressableScale onPress={() => setConfirming(true)} disabled={!ready || busy} haptic="tap" className="gym-btn" style={{ opacity: ready && !busy ? 1 : 0.5, marginTop: 4 }} accessibilityRole="button" accessibilityLabel={item ? "Save changes" : title} accessibilityState={{ disabled: !ready || busy }}>
                <GradientFill radius={14} />
                {busy ? <ActivityIndicator size="small" color={colors.white} /> : <SymbolView name={{ ios: "arrowtriangle.right.fill", android: "arrow_right", web: "arrow_right" }} size={14} tintColor={colors.white} />}
                <Text className="gym-btn__label">{item ? "Save changes" : title}</Text>
              </PressableScale>
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
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
      </Animated.View>
      {confirming && (
        <Animated.View entering={FadeIn.duration(140).reduceMotion(ReduceMotion.System)} className="gym-confirm" accessibilityViewIsModal>
          <View className="gym-confirm__card">
            <Text className="gym-confirm__title" accessibilityRole="header">Please confirm the details</Text>
            <View style={{ gap: 14 }}>
              {[
                ["Name", name.trim()],
                ...(isPlan && length !== null ? [["Duration", planLabel(length, unit)]] : []),
                ["Amount", rupees(amount)],
              ].map(([label, value]) => (
                <View key={label} className="flex-row items-center justify-between" style={{ gap: 12 }} accessible accessibilityLabel={`${label}: ${value}`}>
                  <Text className="gym-confirm__label">{label}</Text>
                  <Text className="gym-confirm__value" numberOfLines={1}>{value}</Text>
                </View>
              ))}
            </View>
            <View className="flex-row justify-end" style={{ gap: 8 }}>
              <PressableScale onPress={() => setConfirming(false)} className="gym-confirm__action" accessibilityRole="button" accessibilityLabel="Edit">
                <Text className="gym-confirm__action-label">Edit</Text>
              </PressableScale>
              <PressableScale onPress={submit} haptic="tap" className="gym-confirm__action" accessibilityRole="button" accessibilityLabel="Confirm">
                <Text className="gym-confirm__action-label">Confirm</Text>
              </PressableScale>
            </View>
          </View>
        </Animated.View>
      )}
    </Modal>
  );
}
