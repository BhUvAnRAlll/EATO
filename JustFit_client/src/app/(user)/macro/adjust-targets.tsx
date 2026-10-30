import { useCallback, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect } from "expo-router";

import { MacroHeader } from "@/components/macro/MacroHeader";
import { kcalOf, macro, macrosAgree, whole, type TargetStatus } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { useHomeStore } from "@/store/home";
import { colors } from "@/theme";
import { fonts } from "@/constants/fonts";

const macroFields = [
  { key: "proteinG", label: "Protein", color: colors.protein },
  { key: "carbsG", label: "Carbs", color: colors.carbs },
  { key: "fatG", label: "Fat", color: colors.fat },
] as const;
type MacroKey = (typeof macroFields)[number]["key"];

const numeric = (text: string) => text.replace(/[^\d]/g, "").slice(0, 5);
const toNumber = (text: string) => (text.trim() === "" ? 0 : Number(text));

// Set the daily calorie and macro target by hand, or hand it back to the calculation.
// The server applies the calculator's rules (1000–5000 kcal).
export default function AdjustTargets() {
  const getToken = useSessionToken();
  const [status, setStatus] = useState<TargetStatus | null>(null);
  const [kcal, setKcal] = useState("");
  const [grams, setGrams] = useState<Record<MacroKey, string>>({ proteinG: "", carbsG: "", fatG: "" });
  const [seeded, setSeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);

  // The fields are filled from the saved target once, so a later reload never overwrites typing
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const result = await macro.targets(await getToken().catch(() => null));
        if (cancelled) return;
        if (!result.ok) return setError(result.error);
        setStatus(result.data);
        if (!seeded && result.data.status === "ready") {
          setKcal(String(result.data.kcal));
          setGrams({ proteinG: String(result.data.proteinG), carbsG: String(result.data.carbsG), fatG: String(result.data.fatG) });
          setSeeded(true);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [getToken, seeded]),
  );

  // The Home tab's Today's Macros reads the target too: refresh it on the next visit
  const done = () => {
    useHomeStore.setState({ loadedAt: null });
    router.back();
  };

  const save = async () => {
    if (busy) return;
    setError(null);
    const calories = toNumber(kcal);
    if (!(calories > 0)) return setError("Enter your daily calories.");
    const body: { kcal: number; proteinG?: number; carbsG?: number; fatG?: number } = { kcal: calories };
    for (const field of macroFields) if (grams[field.key].trim() !== "") body[field.key] = toNumber(grams[field.key]);
    setBusy("save");
    const result = await macro.setTargets(await getToken().catch(() => null), body);
    setBusy(null);
    if (!result.ok) return setError(result.error);
    done();
  };

  const reset = async () => {
    if (busy) return;
    setError(null);
    setBusy("reset");
    const result = await macro.resetTargets(await getToken().catch(() => null));
    setBusy(null);
    if (!result.ok) return setError(result.error);
    done();
  };

  const typedKcal = toNumber(kcal);
  const anyMacro = macroFields.some((f) => grams[f.key].trim() !== "");
  const macroKcal = Math.round(kcalOf({ proteinG: toNumber(grams.proteinG), carbsG: toNumber(grams.carbsG), fatG: toNumber(grams.fatG) }));

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <MacroHeader title="Adjust targets" />

        {status === null ? (
          <View className="flex-1 items-center justify-center">
            {error ? <Text className="macro__error px-5 text-center" accessibilityRole="alert">{error}</Text> : <ActivityIndicator color={colors.forest} />}
          </View>
        ) : status.status === "incomplete" ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="placeholder__text">{"Finish your profile first — there's no calculated target yet to adjust."}</Text>
          </View>
        ) : (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 16 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text className="home__lead">
                {status.isManual
                  ? "You set these by hand. justFit keeps them until you reset to the calculated target or update your profile."
                  : "These were calculated from your profile. Change them and justFit will use your numbers instead."}
              </Text>

              <View className="gap-2">
                <Text className="setup__section">Daily calories</Text>
                <View className="setup__field">
                  <SymbolView name={{ ios: "flame.fill", android: "local_fire_department", web: "local_fire_department" }} size={18} tintColor={colors.danger} />
                  <TextInput className="setup__field-input min-w-0 flex-1" value={kcal} onChangeText={(t) => setKcal(numeric(t))} placeholder="2000" placeholderTextColor={colors.faint} keyboardType="number-pad" accessibilityLabel="Daily calories in kcal" />
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
                          placeholder="auto"
                          placeholderTextColor={colors.faint}
                          keyboardType="number-pad"
                          accessibilityLabel={`${m.label} target in grams`}
                        />
                        <Text className="setup__unit">g</Text>
                      </View>
                    </View>
                  ))}
                </View>
                <Text className="home__note">Leave a macro empty and it is split from your calories for your goal.</Text>
              </View>

              {typedKcal > 0 && anyMacro && (
                <View className="flex-row items-center gap-2">
                  <SymbolView
                    name={macrosAgree(typedKcal, macroKcal) ? { ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" } : { ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }}
                    size={16}
                    tintColor={macrosAgree(typedKcal, macroKcal) ? colors.success : colors.warning}
                  />
                  <Text className="home__note flex-1" style={{ color: colors.muted }}>
                    Macros add up to <Text style={{ fontFamily: fonts.semibold, color: colors.forestInk }}>{macroKcal} kcal</Text>
                    {macrosAgree(typedKcal, macroKcal) ? ` — close to your ${whole(typedKcal)} entry.` : ` — far from your ${whole(typedKcal)} entry.`}
                  </Text>
                </View>
              )}

              {error && <Text className="macro__error" accessibilityRole="alert">{error}</Text>}

              {status.canReset && (
                <Pressable onPress={reset} disabled={busy !== null} className="flex-row items-center justify-center gap-2 py-2" accessibilityRole="button" accessibilityLabel="Reset to calculated">
                  {busy === "reset" ? <ActivityIndicator color={colors.forest} /> : <SymbolView name={{ ios: "arrow.counterclockwise", android: "restart_alt", web: "restart_alt" }} size={16} tintColor={colors.forest} />}
                  <Text className="auth__link">Reset to calculated{status.calculated ? ` (${status.calculated.kcal.toLocaleString("en-IN")} kcal)` : ""}</Text>
                </Pressable>
              )}
            </ScrollView>

            <View className="px-5 pb-3 pt-2">
              <Pressable onPress={save} disabled={busy !== null} className="btn-forest" style={{ opacity: busy ? 0.7 : 1 }} accessibilityRole="button" accessibilityLabel="Save targets">
                {busy === "save" && <ActivityIndicator color={colors.white} />}
                <Text className="btn-forest__label">Save targets</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </View>
  );
}
