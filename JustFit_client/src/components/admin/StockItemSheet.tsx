import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from "react-native";

import { AdminField } from "@/components/admin/AdminField";
import { BottomSheet } from "@/components/BottomSheet";
import { FormAlert } from "@/components/FormAlert";
import { KeyboardAvoider } from "@/components/KeyboardAvoider";
import { MOVE_LABEL } from "@/data/kitchens";
import { hud } from "@/lib/hud";
import { kitchensApi, type Kitchen, type StockItem, type StockMove } from "@/lib/kitchensApi";
import { rupees } from "@/lib/mealRules";
import { confirmChoice } from "@/lib/nativeSheets";
import { useSessionToken } from "@/lib/session";
import { useSwitchColors, useThemeColors } from "@/theme";

type Action = "purchase" | "use" | "waste" | "adjust" | "transfer" | "details";
const ACTIONS: { value: Action; label: string }[] = [
  { value: "purchase", label: "Buy" },
  { value: "use", label: "Use" },
  { value: "waste", label: "Waste" },
  { value: "adjust", label: "Count" },
  { value: "transfer", label: "Send" },
  { value: "details", label: "Details" },
];
const SAVE_LABEL: Record<Action, string> = { purchase: "Record purchase", use: "Record use", waste: "Record waste", adjust: "Save count", transfer: "Send stock", details: "Save details" };
const DONE_LABEL: Record<Action, string> = { purchase: "Purchase recorded", use: "Use recorded", waste: "Waste recorded", adjust: "Count saved", transfer: "Stock sent", details: "Saved" };
const typed = (text: string) => text.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// One ingredient in a kitchen (Meal Operations phase 2): how much there is, then Buy (with the price
// per unit), Use, Waste, Count (set what's really there), Send to another kitchen, or Details
// (minimum, price, supplier, expiry, storage), and the last 30 changes. Use and Waste can't take
// more than there is unless "Override" is on with a reason (kept in the history and the admin log).
export function StockItemSheet({ kitchenId, ingredientId, kitchens, onChanged, onClose }: {
  kitchenId: number;
  ingredientId: number;
  kitchens: Kitchen[]; // other kitchens to send to
  onChanged: () => void;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const switchColors = useSwitchColors();
  const getToken = useSessionToken();
  const [item, setItem] = useState<StockItem | null>(null);
  const [moves, setMoves] = useState<StockMove[]>([]);
  const [action, setAction] = useState<Action>("purchase");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [override, setOverride] = useState(false);
  const [to, setTo] = useState<number | null>(null);
  const [details, setDetails] = useState({ min: "", price: "", supplier: "", expiresOn: "", storage: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const show = useCallback((data: { item: StockItem; moves: StockMove[] }) => {
    setItem(data.item);
    setMoves(data.moves);
    setDetails({
      min: String(data.item.minQuantity), price: data.item.unitPrice === null ? "" : String(data.item.unitPrice),
      supplier: data.item.supplier ?? "", expiresOn: data.item.expiresOn ?? "", storage: data.item.storage ?? "",
    });
  }, []);
  useEffect(() => {
    (async () => {
      const answer = await kitchensApi.stockItem(await getToken(), kitchenId, ingredientId);
      if (answer.ok) show(answer.data);
      else setError(answer.error);
    })();
  }, [getToken, kitchenId, ingredientId, show]);

  const qty = Number(quantity);
  const needsNote = override && (action === "use" || action === "waste");
  const ready =
    action === "details"
      ? details.min !== "" && Number(details.min) >= 0 && (details.expiresOn === "" || /^\d{4}-\d{2}-\d{2}$/.test(details.expiresOn))
      : quantity !== "" && (action === "adjust" ? qty >= 0 : qty > 0) && (action !== "transfer" || to !== null) && (!needsNote || note.trim().length >= 3);

  const submit = async () => {
    if (!ready || busy || !item) return;
    setBusy(true);
    setError("");
    const token = await getToken();
    const answer =
      action === "details"
        ? await kitchensApi.saveStock(token, kitchenId, ingredientId, {
            minQuantity: Number(details.min), unitPrice: details.price === "" ? null : Number(details.price),
            supplier: details.supplier.trim() || null, expiresOn: details.expiresOn || null, storage: details.storage.trim() || null,
          })
        : action === "transfer"
          ? await kitchensApi.transfer(token, kitchenId, ingredientId, to!, qty, note.trim() || undefined)
          : await kitchensApi.move(token, kitchenId, ingredientId, {
              kind: action, quantity: qty, ...(action === "purchase" && price !== "" ? { unitPrice: Number(price) } : {}),
              ...(note.trim() ? { note: note.trim() } : {}), ...(override && (action === "use" || action === "waste") ? { override: true } : {}),
            });
    setBusy(false);
    if (!answer.ok) return setError(answer.error);
    show(answer.data);
    setQuantity("");
    setPrice("");
    setNote("");
    setOverride(false);
    hud.success(DONE_LABEL[action]);
    onChanged();
  };

  const remove = async (dismiss: () => void) => {
    if (!item) return;
    const sure = await confirmChoice({ title: `Take ${item.name} off this kitchen?`, message: "Its history stays. You can add it again later.", confirmLabel: "Take off", destructive: true });
    if (!sure) return;
    const answer = await kitchensApi.removeStock(await getToken(), kitchenId, ingredientId);
    if (!answer.ok) return hud.error(answer.error);
    hud.success("Taken off");
    onChanged();
    dismiss();
  };

  return (
    <BottomSheet onClose={onClose} locked={busy}>
      {(dismiss) => (
        <KeyboardAvoider fill={false}>
          <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {!item ? (
              error ? <FormAlert message={error} /> : <ActivityIndicator color={colors.leaf} />
            ) : (
              <>
                <View className="flex-row items-end" style={{ gap: 8 }}>
                  <View className="min-w-0 flex-1">
                    <Text className="type-headline text-forest-ink" numberOfLines={1}>{item.name}</Text>
                    <Text className="meta-text">{[`Minimum ${item.minQuantity} ${item.unit}`, item.unitPrice !== null ? `${rupees(item.unitPrice)} / ${item.unit}` : null, item.expiresOn ? `Expires ${item.expiresOn}` : null].filter(Boolean).join(" · ")}</Text>
                  </View>
                  <Text className="type-title" style={{ color: item.out || item.low ? colors.danger : colors.ink }}>{`${item.quantity} ${item.unit}`}</Text>
                </View>
                <View className="flex-row flex-wrap" style={{ gap: 6 }}>
                  {ACTIONS.filter((a) => a.value !== "transfer" || kitchens.length > 0).map((a) => {
                    const on = a.value === action;
                    return (
                      <Pressable key={a.value} onPress={() => { setAction(a.value); setError(""); }} className={on ? "admin-chip admin-chip--on" : "admin-chip"} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                        <Text className={on ? "admin-segment__label admin-segment__label--on" : "admin-segment__label"}>{a.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                {action === "details" ? (
                  <>
                    <View className="flex-row" style={{ gap: 10 }}>
                      <View className="flex-1"><AdminField label={`Minimum (${item.unit})`} value={details.min} onChangeText={(t) => setDetails({ ...details, min: typed(t) })} keyboardType="decimal-pad" maxLength={9} /></View>
                      <View className="flex-1"><AdminField label={`Price per ${item.unit} (₹)`} value={details.price} onChangeText={(t) => setDetails({ ...details, price: typed(t) })} keyboardType="decimal-pad" maxLength={9} /></View>
                    </View>
                    <AdminField label="Supplier (optional)" value={details.supplier} onChangeText={(t) => setDetails({ ...details, supplier: t })} maxLength={80} />
                    <AdminField label="Expiry date (optional)" value={details.expiresOn} onChangeText={(t) => setDetails({ ...details, expiresOn: t.replace(/[^0-9-]/g, "").slice(0, 10) })} placeholder="2026-11-30" keyboardType="numbers-and-punctuation" />
                    <AdminField label="Storage (optional)" value={details.storage} onChangeText={(t) => setDetails({ ...details, storage: t })} maxLength={80} placeholder="Cold room, shelf 2" />
                  </>
                ) : (
                  <>
                    <View className="flex-row" style={{ gap: 10 }}>
                      <View className="flex-1">
                        <AdminField label={action === "adjust" ? `Counted (${item.unit})` : `Quantity (${item.unit})`} value={quantity} onChangeText={(t) => setQuantity(typed(t))} keyboardType="decimal-pad" maxLength={9} placeholder="How much" />
                      </View>
                      {action === "purchase" ? <View className="flex-1"><AdminField label={`Price per ${item.unit} (₹)`} value={price} onChangeText={(t) => setPrice(typed(t))} keyboardType="decimal-pad" maxLength={9} placeholder="Optional" /></View> : null}
                    </View>
                    {action === "transfer" ? (
                      <View className="gap-1.5">
                        <Text className="auth__label">Send to</Text>
                        <View className="flex-row flex-wrap gap-2">
                          {kitchens.map((k) => (
                            <Pressable key={k.id} onPress={() => setTo(k.id)} className={to === k.id ? "setup__chip setup__chip--selected" : "setup__chip"} accessibilityRole="radio" accessibilityState={{ selected: to === k.id }}>
                              <Text className={to === k.id ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{k.name}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    ) : null}
                    {action === "use" || action === "waste" ? (
                      <View className="flex-row items-center" style={{ gap: 12 }}>
                        <View className="flex-1">
                          <Text className="card__title">Override the stock check</Text>
                          <Text className="meta-text">Take more than the system shows (with a reason).</Text>
                        </View>
                        <Switch value={override} onValueChange={setOverride} {...switchColors} accessibilityLabel="Override the stock check" />
                      </View>
                    ) : null}
                    <AdminField label={needsNote ? "Reason" : "Note (optional)"} value={note} onChangeText={setNote} maxLength={120} placeholder={action === "waste" ? "For example: Spoiled overnight" : "For example: Bill #4521"} />
                  </>
                )}
                {error ? <FormAlert message={error} /> : null}
                <Pressable onPress={submit} disabled={!ready || busy} className={ready ? "btn-forest" : "btn-forest btn--disabled"} accessibilityRole="button">
                  {busy && <ActivityIndicator size="small" color={colors.onPrimary} />}
                  <Text className={ready ? "btn-forest__label" : "btn-forest__label btn--disabled-label"}>{SAVE_LABEL[action]}</Text>
                </Pressable>

                <Text className="admin-section__title">History</Text>
                {moves.length === 0 ? (
                  <Text className="meta-text">No changes yet.</Text>
                ) : (
                  moves.map((m) => (
                    <View key={m.id} className="flex-row" style={{ gap: 8 }}>
                      <View className="min-w-0 flex-1">
                        <Text className="type-body text-forest-ink">{`${MOVE_LABEL[m.kind]} ${Math.abs(m.quantity)} ${item.unit}${m.otherKitchen ? ` · ${m.kind === "transfer_out" ? "to" : "from"} ${m.otherKitchen}` : ""}${m.overridden ? " · override" : ""}`}</Text>
                        <Text className="meta-text" numberOfLines={2}>{[when(m.at), m.note].filter(Boolean).join(" · ")}</Text>
                      </View>
                      <Text className="meta-text">{`= ${m.balanceAfter}`}</Text>
                    </View>
                  ))
                )}
                {item.quantity <= 0 ? (
                  <Pressable onPress={() => remove(dismiss)} className="self-center" hitSlop={10} accessibilityRole="button">
                    <Text className="meta-text" style={{ color: colors.danger }}>Take off this kitchen</Text>
                  </Pressable>
                ) : null}
              </>
            )}
          </ScrollView>
        </KeyboardAvoider>
      )}
    </BottomSheet>
  );
}
