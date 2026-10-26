import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";

import { MacroHeader } from "@/components/macro/MacroHeader";
import { Segmented } from "@/components/macro/Segmented";
import { pickScanPhoto, type PhotoSource, type ScanPhoto } from "@/lib/bodyScan";
import { loggedAtFor, macro, slotForNow, slotInfo, slots, todayIso, whole, type MealItem, type Slot } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { useMacroStore } from "@/store/macro";
import { colors } from "@/theme";

const macroFields = [
  { key: "kcal", label: "kcal", color: colors.danger },
  { key: "proteinG", label: "Protein", color: colors.protein },
  { key: "carbsG", label: "Carbs", color: colors.carbs },
  { key: "fatG", label: "Fat", color: colors.fat },
] as const;
type MacroKey = (typeof macroFields)[number]["key"];

// Digits and one decimal point only, at most 6 characters
const numeric = (text: string) => text.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 6);
// The editable copy of a scanned food: numbers as typed text
type Row = { name: string; quantity: number; unit: string } & Record<MacroKey, string>;
const toRow = (item: MealItem): Row => ({ name: item.name, quantity: item.quantity, unit: item.unit, kcal: String(whole(item.kcal)), proteinG: String(item.proteinG), carbsG: String(item.carbsG), fatG: String(item.fatG) });
const num = (text: string) => (text.trim() === "" ? 0 : Number(text));

// Logging by photo: pick or take a photo, the server asks OpenAI for an estimate of each
// food on the plate, the member checks the numbers, and the meal is saved like a manual one.
export default function ScanFood() {
  const params = useLocalSearchParams<{ slot?: string; hour?: string; minute?: string }>();
  const getToken = useSessionToken();
  const selectedDate = useMacroStore((state) => state.selectedDate);
  const [photo, setPhoto] = useState<ScanPhoto | null>(null);
  const [hint, setHint] = useState("");
  const [scanning, setScanning] = useState(false);
  const [title, setTitle] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [slot, setSlot] = useState<Slot>(slots.includes(params.slot as Slot) ? (params.slot as Slot) : slotForNow());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const scan = async (picked: ScanPhoto) => {
    setScanning(true);
    setError(null);
    const result = await macro.scanFood(await getToken().catch(() => null), { data: picked.data, hint });
    setScanning(false);
    if (!result.ok) return setError(result.status ? result.error : "Could not reach JustFit. Check your connection and try again.");
    setTitle(result.data.scan.title);
    setRows(result.data.scan.items.map(toRow));
  };

  const pick = async (source: PhotoSource) => {
    setError(null);
    const picked = await pickScanPhoto(source);
    if (!picked.ok) {
      if ("error" in picked) setError(picked.error);
      return;
    }
    setPhoto(picked.photo);
    setRows(null);
    await scan(picked.photo);
  };

  const startOver = () => {
    setPhoto(null);
    setRows(null);
    setError(null);
  };

  const setField = (index: number, key: MacroKey, text: string) =>
    setRows((current) => current && current.map((row, i) => (i === index ? { ...row, [key]: numeric(text) } : row)));
  const removeRow = (index: number) => setRows((current) => current && current.filter((_, i) => i !== index));

  const totals = (rows ?? []).reduce((sum, row) => ({ kcal: sum.kcal + num(row.kcal), proteinG: sum.proteinG + num(row.proteinG), carbsG: sum.carbsG + num(row.carbsG), fatG: sum.fatG + num(row.fatG) }), { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });

  const save = async () => {
    if (saving || !rows) return;
    setError(null);
    if (selectedDate !== todayIso()) return setError("Meals can only be logged for today.");
    if (rows.length === 0) return setError("Keep at least one food, or scan again.");
    if (!title.trim()) return setError("Give the meal a name.");
    setSaving(true);
    const result = await macro.logMeal(await getToken().catch(() => null), {
      date: selectedDate,
      slot,
      title: title.trim(),
      loggedAt: loggedAtFor(selectedDate, params.hour, params.minute), // the time chosen on Add meal, or now
      source: "manual",
      items: rows.map((row) => ({ name: row.name, quantity: row.quantity, unit: row.unit, kcal: num(row.kcal), proteinG: num(row.proteinG), carbsG: num(row.carbsG), fatG: num(row.fatG) })),
    });
    setSaving(false);
    if (!result.ok) return setError(result.status ? result.error : "Could not save that meal.");
    router.dismissTo("/macro"); // the Macro tab reloads the day when it comes back into view
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <MacroHeader title="Scan food" />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 16 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {photo ? (
              <Image source={{ uri: photo.previewUri }} contentFit="cover" style={{ width: "100%", height: 220, borderRadius: 20 }} accessibilityLabel="Your food photo" />
            ) : (
              <>
                <Text className="home__lead">{"Snap your plate and we'll estimate the calories, protein, carbs and fat. You can check every number before it's added."}</Text>
                <View className="home__empty mx-0">
                  <SymbolView name={{ ios: "camera.viewfinder", android: "photo_camera", web: "photo_camera" }} size={34} tintColor={colors.leaf} />
                  <Text className="card__title text-center">Photograph your meal</Text>
                  <Text className="placeholder__text">Shoot from above in good light, with the whole plate in view.</Text>
                </View>
                <View className="gap-2">
                  <Text className="setup__section">Note (optional)</Text>
                  <View className="setup__field">
                    <SymbolView name={{ ios: "text.bubble", android: "chat", web: "chat" }} size={18} tintColor={colors.muted} />
                    <TextInput className="setup__field-input min-w-0 flex-1" value={hint} onChangeText={setHint} placeholder="2 rotis, paneer butter masala" placeholderTextColor={colors.faint} maxLength={200} accessibilityLabel="Note about the food" />
                  </View>
                </View>
              </>
            )}

            {scanning && (
              <View className="flex-row items-center justify-center gap-3 py-4">
                <ActivityIndicator color={colors.leaf} />
                <Text className="home__lead">Reading your plate…</Text>
              </View>
            )}

            {rows && (
              <>
                <View className="gap-2">
                  <Text className="setup__section">Meal name</Text>
                  <View className="setup__field">
                    <SymbolView name={{ ios: "pencil", android: "edit", web: "edit" }} size={18} tintColor={colors.muted} />
                    <TextInput className="setup__field-input min-w-0 flex-1" value={title} onChangeText={setTitle} maxLength={120} accessibilityLabel="Meal name" />
                  </View>
                </View>

                <View className="gap-3">
                  <Text className="setup__section">Foods we found</Text>
                  {rows.map((row, index) => (
                    <View key={`${row.name}-${index}`} className="home__card gap-3">
                      <View className="flex-row items-center gap-3">
                        <View className="min-w-0 flex-1">
                          <Text className="card__title" numberOfLines={1}>{row.name}</Text>
                          <Text className="post__time">{row.quantity} {row.unit}</Text>
                        </View>
                        <Pressable onPress={() => removeRow(index)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${row.name}`}>
                          <SymbolView name={{ ios: "trash", android: "delete", web: "delete" }} size={18} tintColor={colors.muted} />
                        </Pressable>
                      </View>
                      <View className="flex-row flex-wrap gap-2">
                        {macroFields.map((m) => (
                          <View key={m.key} className="macro__macro-box basis-2/5">
                            <View className="flex-row items-center gap-1.5">
                              <View className="h-2 w-2 rounded-pill" style={{ backgroundColor: m.color }} />
                              <Text className="macro__bar-label">{m.label}</Text>
                            </View>
                            <View className="mt-1 min-w-0 flex-row items-baseline gap-1">
                              <TextInput
                                className="setup__field-input min-w-0 flex-1"
                                value={row[m.key]}
                                onChangeText={(t) => setField(index, m.key, t)}
                                placeholder="0"
                                placeholderTextColor={colors.faint}
                                keyboardType="decimal-pad"
                                accessibilityLabel={`${row.name} ${m.label}${m.key === "kcal" ? "" : " in grams"}`}
                              />
                              {m.key !== "kcal" && <Text className="setup__unit">g</Text>}
                            </View>
                          </View>
                        ))}
                      </View>
                    </View>
                  ))}
                  {rows.length === 0 && <Text className="home__note">Every food was removed. Scan again to start over.</Text>}
                </View>

                <View className="macro__panel flex-row justify-between">
                  <Text className="card__title">Total</Text>
                  <Text className="card__title">
                    {whole(totals.kcal)} kcal · P {whole(totals.proteinG)}g · C {whole(totals.carbsG)}g · F {whole(totals.fatG)}g
                  </Text>
                </View>

                <View className="gap-2">
                  <Text className="setup__section">Add to</Text>
                  <Segmented options={slots.map((s) => ({ value: s, label: slotInfo[s].label }))} value={slot} onChange={setSlot} label="Meal slot" />
                </View>

                <View className="setup__note">
                  <SymbolView name={{ ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }} size={22} tintColor={colors.leaf} />
                  <Text className="setup__note-text flex-1 self-center">These are estimates from your photo. Portions and recipes vary, so adjust anything that looks off.</Text>
                </View>
              </>
            )}

            {error && <Text className="macro__error" accessibilityRole="alert">{error}</Text>}
          </ScrollView>

          <View className="gap-3 px-5 pb-3 pt-2">
            {rows ? (
              <>
                <Pressable onPress={save} disabled={saving} className="btn-forest" style={{ opacity: saving ? 0.7 : 1 }} accessibilityRole="button" accessibilityLabel="Add to my day">
                  {saving ? <ActivityIndicator color={colors.white} /> : <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={16} tintColor={colors.white} />}
                  <Text className="btn-forest__label">Add to my day</Text>
                </Pressable>
                <Pressable onPress={startOver} disabled={saving} className="btn-outline" accessibilityRole="button">
                  <Text className="btn-outline__label">Scan another photo</Text>
                </Pressable>
              </>
            ) : photo && !scanning ? (
              <>
                <Pressable onPress={() => scan(photo)} className="btn-forest" accessibilityRole="button">
                  <Text className="btn-forest__label">Try again</Text>
                </Pressable>
                <Pressable onPress={startOver} className="btn-outline" accessibilityRole="button">
                  <Text className="btn-outline__label">Choose another photo</Text>
                </Pressable>
              </>
            ) : !photo ? (
              <>
                <Pressable onPress={() => pick("camera")} className="btn-forest" accessibilityRole="button">
                  <SymbolView name={{ ios: "camera.fill", android: "photo_camera", web: "photo_camera" }} size={16} tintColor={colors.white} />
                  <Text className="btn-forest__label">Take photo</Text>
                </Pressable>
                <Pressable onPress={() => pick("library")} className="btn-outline" accessibilityRole="button">
                  <Text className="btn-outline__label">Choose from library</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
