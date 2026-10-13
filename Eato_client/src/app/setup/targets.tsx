import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { useAuth, useUser } from "@clerk/expo";

import { FormAlert } from "@/components/FormAlert";
import { OptionCard } from "@/components/setup/OptionCard";
import { SetupScreen } from "@/components/setup/SetupScreen";
import { goHome } from "@/lib/auth";
import { getClerkErrorMessage } from "@/lib/clerk";
import { saveProfile } from "@/lib/profile";
import {
  applyUserAdjustment,
  calculateTargets,
  calculatorConfig,
  createManualRecord,
  createTargetRecord,
  manualBodyFatReport,
  manualTargetMacros,
  waterRecommendation,
  type CalculatorInput,
  type EquationGender,
  type Macros,
  type TargetRecord,
} from "@/lib/nutrition";
import { useSetupStore } from "@/store/setup";
import type { Icon } from "@/types/profile";
import { colors } from "@/theme";

const CALORIE_STEP = 50;
const { kcalPerGram } = calculatorConfig;

type MacroTileProps = { label: string; value: string; note: string; color: string; icon: Icon };

// Coloured ring with an icon, plus the amount and its share of calories
function MacroTile({ label, value, note, color, icon }: MacroTileProps) {
  return (
    <View className="setup__card flex-1 flex-row items-center gap-3">
      <View className="setup__ring" style={{ borderColor: color }}>
        <SymbolView name={icon} size={18} tintColor={color} />
      </View>
      <View>
        <Text className="setup__card-text">{label}</Text>
        <Text className="setup__macro-value">{value}</Text>
        <Text className="setup__card-text">{note}</Text>
      </View>
    </View>
  );
}

function MacroGrid({ calories, macros }: { calories: number; macros: Macros }) {
  const percent = (grams: number, kcal: number) => `${Math.round(((grams * kcal) / calories) * 100)}% of kcal`;
  return (
    <View className="mt-3 gap-3">
      <View className="flex-row gap-3">
        <MacroTile
          label="Protein"
          value={`${macros.proteinG} g`}
          note={percent(macros.proteinG, kcalPerGram.protein)}
          color={colors.protein}
          icon={{ ios: "bolt.fill", android: "bolt", web: "bolt" }}
        />
        <MacroTile
          label="Carbs"
          value={`${macros.carbsG} g`}
          note={percent(macros.carbsG, kcalPerGram.carbs)}
          color={colors.carbs}
          icon={{ ios: "leaf.fill", android: "grain", web: "grain" }}
        />
      </View>
      <MacroTile
        label="Fats"
        value={`${macros.fatG} g`}
        note={percent(macros.fatG, kcalPerGram.fat)}
        color={colors.fat}
        icon={{ ios: "drop.halffull", android: "opacity", web: "opacity" }}
      />
    </View>
  );
}

// Account metadata worth keeping when the setup flag is written (the sign-up account type)
function keptMetadata(metadata: Record<string, unknown>) {
  return metadata.accountType !== undefined ? { accountType: metadata.accountType } : {};
}

export default function NutritionTargets() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const { profile, calorieOverride, setCalorieOverride, reset, report } = useSetupStore();

  // Only for gender "other"/"unspecified": the estimate the user picks (never chosen for them)
  const [equationGender, setEquationGender] = useState<EquationGender | null>(null);
  // Manual pathway: a target from a doctor/dietitian, or the user's own
  const [isManual, setIsManual] = useState(false);
  const [manualCalories, setManualCalories] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const input: Partial<CalculatorInput> = {
    age: Number(profile.age),
    gender: profile.gender ?? "unspecified",
    equationGender: equationGender ?? undefined,
    heightCm: Number(profile.heightCm),
    weightKg: Number(profile.weightKg),
    activityLevel: profile.activity ?? undefined,
    fitnessGoal: profile.goal ?? undefined,
    healthFlags: profile.healthFlags,
    // A confirmed report (or a typed body fat %) makes the calculator use
    // Katch–McArdle; it decides itself whether the report is recent enough
    bodyComposition:
      report ??
      (profile.bodyFatPercent !== ""
        ? manualBodyFatReport(Number(profile.weightKg), Number(profile.bodyFatPercent))
        : undefined),
  };
  const result = calculateTargets(input);
  const weightKg = Number(profile.weightKg);
  const goal = profile.goal ?? "maintenance";

  // Professional guidance always uses the manual pathway
  const manualMode = isManual || result.status === "needs_professional_guidance";
  const manual = manualMode ? manualTargetMacros(Number(manualCalories), weightKg, goal) : null;

  // What will be saved/shown in the normal pathway (calculated, or nudged by the user)
  const shownCalories = result.status === "ok" ? (calorieOverride ?? result.displayCalories) : 0;
  const adjusted = result.status === "ok" && calorieOverride !== null ? manualTargetMacros(calorieOverride, weightKg, goal) : null;
  const shownMacros = result.status === "ok" ? (adjusted?.ok ? adjusted.macros : result.macros) : null;

  const water = profile.activity
    ? waterRecommendation({ weightKg, activityLevel: profile.activity, healthFlags: profile.healthFlags })
    : null;

  const canFinish = manualMode ? manual?.ok === true : result.status === "ok";

  const changeCalories = (delta: number) => {
    const { min, max } = calculatorConfig.safety.manualTarget;
    setCalorieOverride(Math.min(max, Math.max(min, shownCalories + delta)));
  };

  // Builds the saved record (inputs, calculation, active target and its source)
  const buildRecord = (): { ok: true; record: TargetRecord } | { ok: false; error: string } => {
    const actor = user?.id ?? "user";
    const valid = input as CalculatorInput;
    if (manualMode) {
      const reason =
        result.status === "needs_professional_guidance"
          ? "Target from a health professional"
          : "Entered by the user instead of the standard estimate";
      return createManualRecord(valid, Number(manualCalories), reason, actor);
    }
    if (result.status !== "ok") return { ok: false, error: "Your target couldn't be calculated." };
    const record = createTargetRecord(valid, result);
    if (calorieOverride === null || calorieOverride === result.displayCalories) return { ok: true, record };
    return applyUserAdjustment(record, calorieOverride, "Adjusted during setup", actor);
  };

  // Saves the profile and target record to the EATO server (MySQL), then marks setup
  // complete on the Clerk account so the start screen can route straight to home.
  // `isSaving` disables the button, so a double tap can't send two requests.
  const handleFinish = async () => {
    if (!user || isSaving) return;
    const built = buildRecord();
    if (!built.ok) return setError(built.error);

    setError(null);
    setIsSaving(true);
    // The confirmed report values travel inside the record's inputs so the server can
    // re-check the calculation; the uploaded file itself was never stored.
    const saved = await saveProfile(await getToken(), { profile, nutrition: built.record });
    if (!saved.ok) {
      setError(saved.error);
      setIsSaving(false);
      return;
    }
    try {
      const [firstName, ...rest] = profile.fullName.trim().split(/\s+/);
      await user.update({ firstName, lastName: rest.join(" ") });
      // Only the flag lives on the account; the profile and targets are on the server
      await user.updateMetadata({ unsafeMetadata: { ...keptMetadata(user.unsafeMetadata), profileComplete: true } });
      reset();
      goHome();
    } catch (err) {
      setError(getClerkErrorMessage(err));
      setIsSaving(false);
    }
  };

  return (
    <SetupScreen
      step="targets"
      title="Your nutrition targets"
      subtitle="Estimated from your profile. These are starting points, not measurements, and you can adjust them later."
      onNext={handleFinish}
      nextLabel="Finish"
      canContinue={canFinish}
      loading={isSaving}
    >
      {result.status === "invalid" && (
        <View className="gap-2">
          {result.issues.map((issue) => (
            <FormAlert key={issue.field} message={issue.message} />
          ))}
          <Text className="setup__card-text mt-1">Go back and check your details to see your targets.</Text>
        </View>
      )}

      {/* Gender other/unspecified: let the user choose — never pick an equation silently */}
      {result.status === "needs_equation_choice" && !isManual && (
        <View className="gap-3">
          <Text className="setup__card-text">
            The standard formula has male and female versions. Choose the estimate that fits you best, or enter a target
            from your doctor or dietitian.
          </Text>
          {(["male", "female"] as const).map((option) => (
            <OptionCard
              key={option}
              label={`Use the ${option} estimate`}
              selected={equationGender === option}
              onPress={() => setEquationGender(option)}
            />
          ))}
          <OptionCard label="Enter my own target" selected={false} onPress={() => setIsManual(true)} />
        </View>
      )}

      {result.status === "needs_professional_guidance" && (
        <View className="setup__info mb-4">
          <SymbolView name={{ ios: "info.circle", android: "info", web: "info" }} size={16} tintColor={colors.forest} />
          <View className="flex-1 gap-1.5">
            {result.reasons.map((reason) => (
              <Text key={reason} className="setup__card-text">
                {reason}
              </Text>
            ))}
          </View>
        </View>
      )}

      {/* Manual pathway */}
      {manualMode && (
        <View>
          <Text className="setup__section">Daily calorie target</Text>
          <View className="setup__field mt-2.5">
            <SymbolView
              name={{ ios: "flame.fill", android: "local_fire_department", web: "local_fire_department" }}
              size={20}
              tintColor={colors.inkSoft}
            />
            <TextInput
              className="setup__field-input flex-1"
              placeholder="e.g. 2000"
              placeholderTextColor={colors.faint}
              keyboardType="number-pad"
              value={manualCalories}
              onChangeText={(text) => setManualCalories(text.replace(/\D/g, "").slice(0, 4))}
            />
            <Text className="setup__unit">kcal</Text>
          </View>
          {manualCalories !== "" && manual && !manual.ok && (
            <View className="mt-2">
              <FormAlert message={manual.error} />
            </View>
          )}
          {manual?.ok && <MacroGrid calories={Number(manualCalories)} macros={manual.macros} />}
          {isManual && result.status !== "needs_professional_guidance" && (
            <Text className="auth__link mt-3" onPress={() => setIsManual(false)}>
              Use the standard estimate instead
            </Text>
          )}
        </View>
      )}

      {/* Normal pathway */}
      {result.status === "ok" && !manualMode && shownMacros && (
        <View>
          <View className="setup__card flex-row items-center gap-3.5 py-4">
            <SymbolView
              name={{ ios: "flame.fill", android: "local_fire_department", web: "local_fire_department" }}
              size={28}
              tintColor={colors.forest}
            />
            <View className="flex-1">
              <Text className="setup__card-text">{calorieOverride !== null ? "Your adjusted target" : "Estimated daily target"}</Text>
              <Text className="setup__kcal">
                {shownCalories.toLocaleString("en-IN")} <Text className="setup__unit">kcal</Text>
              </Text>
            </View>
            {isEditing ? (
              <View className="flex-row items-center gap-2">
                <Pressable onPress={() => changeCalories(-CALORIE_STEP)} className="setup__stepper">
                  <SymbolView name={{ ios: "minus", android: "remove", web: "remove" }} size={16} tintColor={colors.forestInk} />
                </Pressable>
                <Pressable onPress={() => changeCalories(CALORIE_STEP)} className="setup__stepper">
                  <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={16} tintColor={colors.forestInk} />
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={() => setIsEditing(true)} className="setup__chip">
                <Text className="setup__chip-label">Edit</Text>
              </Pressable>
            )}
          </View>

          <MacroGrid calories={shownCalories} macros={shownMacros} />

          {isEditing && (
            <Pressable
              onPress={() => {
                setCalorieOverride(null);
                setIsEditing(false);
              }}
              className="setup__info mt-3 items-center"
            >
              <SymbolView
                name={{ ios: "arrow.uturn.backward", android: "undo", web: "undo" }}
                size={16}
                tintColor={colors.forest}
              />
              <Text className="setup__chip-label flex-1">Reset to the estimate ({result.displayCalories.toLocaleString("en-IN")} kcal)</Text>
            </Pressable>
          )}

          {/* The device's own suggestion: reference only, never used as the target */}
          {result.rmrFormula === "katch_mcardle" && report?.printedRecommendedIntakeKcal != null && (
            <Text className="setup__card-text mt-3">
              {`Your body composition device printed a recommended intake of ${report.printedRecommendedIntakeKcal.toLocaleString("en-IN")} kcal. It's shown for reference only; your target above is calculated from your fat-free mass, activity and goal.`}
            </Text>
          )}

          {result.reportExpired && (
            <View className="setup__info mt-3">
              <SymbolView name={{ ios: "doc.badge.clock", android: "update", web: "update" }} size={16} tintColor={colors.forest} />
              <Text className="setup__card-text flex-1">
                Your body composition report has expired. Upload a newer one from your profile to use it again.
              </Text>
            </View>
          )}

          {result.warnings.map((warning) => (
            <View key={warning} className="setup__info mt-3">
              <SymbolView name={{ ios: "info.circle", android: "info", web: "info" }} size={16} tintColor={colors.forest} />
              <Text className="setup__card-text flex-1">{warning}</Text>
            </View>
          ))}

          <Text className="setup__card-text mt-3">
            {`${result.formulaReason} Resting ≈ ${Math.round(result.rmr).toLocaleString("en-IN")} kcal, daily ≈ ${Math.round(result.tdee).toLocaleString("en-IN")} kcal. These are estimates; we'll help you review them as you track your progress.`}
          </Text>
        </View>
      )}

      {/* Water: separate from calories */}
      {water && (result.status === "ok" || manualMode) && (
        <View className="setup__card mt-4 flex-row items-center gap-3">
          <View className="setup__ring" style={{ borderColor: colors.info }}>
            <SymbolView name={{ ios: "drop.fill", android: "water_drop", web: "water_drop" }} size={18} tintColor={colors.info} />
          </View>
          <View className="flex-1">
            <Text className="setup__card-text">Drinking water</Text>
            {water.status === "ok" && <Text className="setup__macro-value">{water.drinkingWaterL} L / day</Text>}
            <Text className="setup__card-text">{water.note}</Text>
          </View>
        </View>
      )}

      {error && (
        <View className="mt-3">
          <FormAlert message={error} />
        </View>
      )}
    </SetupScreen>
  );
}
