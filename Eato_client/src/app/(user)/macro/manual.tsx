import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router, useLocalSearchParams } from "expo-router";

import { MacroHeader } from "@/components/macro/MacroHeader";
import { Segmented } from "@/components/macro/Segmented";
import { kcalOf, loggedAtFor, macro, macrosAgree, slotForNow, slotInfo, slots, todayIso, whole, type Slot } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { useMacroStore } from "@/store/macro";
import { colors } from "@/theme";

type Unit = "g" | "oz" | "cup";
const units: { value: Unit; label: string }[] = [
  { value: "g", label: "g" },
  { value: "oz", label: "oz" },
  { value: "cup", label: "cup" },
];
const macroFields = [
  { key: "protein", label: "Protein", color: colors.protein },
  { key: "carbs", label: "Carbs", color: colors.carbs },
  { key: "fat", label: "Fat", color: colors.fat },
] as const;

// Digits and one decimal point only, at most 6 characters
const numeric = (text: string) => text.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 6);
const toNumber = (text: string) => (text.trim() === "" ? 0 : Number(text));

// Logging by hand: a food's name, amount, calories and macros, saved as one meal. On
// success the whole logging flow closes back to the Macro tab.
export default function ManualEntry() {
  const params = useLocalSearchParams<{ slot?: string; hour?: string; minute?: string }>();
  const getToken = useSessionToken();
  const selectedDate = useMacroStore((state) => state.selectedDate);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<Unit>("g");
  const [kcal, setKcal] = useState("");
  const [grams, setGrams] = useState({ protein: "", carbs: "", fat: "" });
  const [slot, setSlot] = useState<Slot>(slots.includes(params.slot as Slot) ? (params.slot as Slot) : slotForNow());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const macroKcal = Math.round(kcalOf({ proteinG: toNumber(grams.protein), carbsG: toNumber(grams.carbs), fatG: toNumber(grams.fat) }));
  const typedKcal = toNumber(kcal);
  const showSanity = typedKcal > 0 && (grams.protein !== "" || grams.carbs !== "" || grams.fat !== "");

  const save = async () => {
    if (saving) return;
    setError(null);
    if (selectedDate !== todayIso()) return setError("Meals can only be logged for today.");
    if (!name.trim()) return setError("Give the food a name.");
    if (!(typedKcal > 0)) return setError("Enter the calories.");


    const amount = toNumber(quantity);
    setSaving(true);
    const result = await macro.logMeal(await getToken().catch(() => null), {
      date: selectedDate,
      slot,
      title: name.trim(),
      loggedAt: loggedAtFor(selectedDate, params.hour, params.minute), // the time chosen on Add meal, or now
      source: "manual",
      items: [{
        name: name.trim(),
        quantity: amount > 0 ? amount : 1,
        unit: amount > 0 ? unit : "serving",
        kcal: typedKcal,
        proteinG: toNumber(grams.protein),
        carbsG: toNumber(grams.carbs),
        fatG: toNumber(grams.fat),
      }],
    });
    setSaving(false);
    if (!result.ok) return setError(result.status ? result.error : "Could not save that food.");
    router.dismissTo("/macro"); // the Macro tab reloads the day when it comes back into view
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <MacroHeader title="Manual entry" />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 16 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text className="home__lead">{"Know the numbers? Type them in and we'll add it to your day."}</Text>

            <View className="gap-2">
              <Text className="setup__section">Food name</Text>
              <View className="setup__field">
                <SymbolView name={{ ios: "pencil", android: "edit", web: "edit" }} size={18} tintColor={colors.muted} />
                <TextInput className="setup__field-input min-w-0 flex-1" value={name} onChangeText={setName} placeholder="Homemade paneer tikka" placeholderTextColor={colors.faint} maxLength={120} accessibilityLabel="Food name" />
              </View>
            </View>

            <View className="gap-2">
              <Text className="setup__section">Quantity</Text>
              <View className="flex-row items-center gap-3">
                <View className="setup__field min-w-0 flex-1">
                  <TextInput className="setup__field-input min-w-0 flex-1" value={quantity} onChangeText={(t) => setQuantity(numeric(t))} placeholder="350" placeholderTextColor={colors.faint} keyboardType="decimal-pad" accessibilityLabel="Quantity" />
                </View>
                <View style={{ width: 150 }}>
                  <Segmented options={units} value={unit} onChange={setUnit} label="Serving unit" />
                </View>
              </View>
            </View>

            <View className="gap-2">
              <Text className="setup__section">Calories</Text>
              <View className="setup__field">
                <SymbolView name={{ ios: "flame.fill", android: "local_fire_department", web: "local_fire_department" }} size={18} tintColor={colors.danger} />
                <TextInput className="setup__field-input min-w-0 flex-1" value={kcal} onChangeText={(t) => setKcal(numeric(t))} placeholder="480" placeholderTextColor={colors.faint} keyboardType="decimal-pad" accessibilityLabel="Calories in kcal" />
                <Text className="setup__unit">kcal</Text>
              </View>
            </View>

            <View className="gap-2">
              <Text className="setup__section">Macros</Text>
              <View className="flex-row gap-2">
                {macroFields.map((m) => (
                  <View key={m.key} className="macro__macro-box">
                    <View className="flex-row items-center gap-1.5">
                      <View className="h-2 w-2 rounded-pill" style={{ backgroundColor: m.color }} />
                      <Text className="macro__bar-label">{m.label}</Text>
                    </View>
                    <View className="mt-1 min-w-0 flex-row items-baseline gap-1">
                      <TextInput
                        className="setup__field-input min-w-0 flex-1"
                        value={grams[m.key]}
                        onChangeText={(t) => setGrams((g) => ({ ...g, [m.key]: numeric(t) }))}
                        placeholder="0"
                        placeholderTextColor={colors.faint}
                        keyboardType="decimal-pad"
                        accessibilityLabel={`${m.label} in grams`}
                      />
                      <Text className="setup__unit">g</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>

            <View className="gap-2">
              <Text className="setup__section">Add to</Text>
              <Segmented options={slots.map((s) => ({ value: s, label: slotInfo[s].label }))} value={slot} onChange={setSlot} label="Meal slot" />
            </View>

            {showSanity && (
              <View className="flex-row items-center gap-2">
                <SymbolView
                  name={macrosAgree(typedKcal, macroKcal) ? { ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" } : { ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }}
                  size={16}
                  tintColor={macrosAgree(typedKcal, macroKcal) ? colors.success : colors.warning}
                />
                <Text className="home__note flex-1" style={{ color: colors.muted }}>
                  Macros add up to <Text style={{ fontWeight: "700", color: colors.forestInk }}>{macroKcal} kcal</Text>
                  {macrosAgree(typedKcal, macroKcal) ? ` — close to your ${whole(typedKcal)} entry. Looks good.` : ` — far from your ${whole(typedKcal)} entry. Worth a second look.`}
                </Text>
              </View>
            )}

            {error && <Text className="macro__error" accessibilityRole="alert">{error}</Text>}
          </ScrollView>

          <View className="px-5 pb-3 pt-2">
            <Pressable onPress={save} disabled={saving} className="btn-forest" style={{ opacity: saving ? 0.7 : 1 }} accessibilityRole="button" accessibilityLabel="Add food">
              {saving ? <ActivityIndicator color={colors.white} /> : <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={16} tintColor={colors.white} />}
              <Text className="btn-forest__label">Add food</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
