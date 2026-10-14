import { useState } from "react";
import { Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { Redirect, router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { DatePickerSheet } from "@/components/setup/DatePickerSheet";
import { ReviewRow } from "@/components/setup/ReviewRow";
import { SelectSheet } from "@/components/setup/SelectSheet";
import { SetupScreen } from "@/components/setup/SetupScreen";
import { formatDob } from "@/lib/date";
import {
  calculatorConfig,
  hasSegmentalData,
  reportCompletenessIssues,
  reportConsistencyIssues,
  reportStatus,
  type BodyCompositionReport,
  type EquationGender,
} from "@/lib/nutrition";
import { useSetupStore } from "@/store/setup";
import type { Icon, Option } from "@/types/profile";
import { colors } from "@/theme";

type NumberField =
  | "age"
  | "heightCm"
  | "weightKg"
  | "percentBodyFat"
  | "skeletalMuscleMassKg"
  | "bodyFatMassKg"
  | "fatFreeMassKg"
  | "printedBmrKcal"
  | "printedRecommendedIntakeKcal";

type FieldLook = { icon: Icon; tint: string; background: string };

// Soft icon tiles, one colour per kind of value (from the review mockup)
const look = {
  date: { icon: { ios: "calendar", android: "calendar_month", web: "calendar_month" }, tint: colors.forest, background: colors.forestSoft },
  gender: { icon: { ios: "figure.stand", android: "wc", web: "wc" }, tint: colors.violet, background: colors.infoSoft },
  age: { icon: { ios: "birthday.cake", android: "cake", web: "cake" }, tint: colors.bronze, background: "#F4EDE0" },
  height: { icon: { ios: "ruler", android: "height", web: "height" }, tint: "#4A7FC1", background: "#E3EDF8" },
  weight: { icon: { ios: "scalemass", android: "monitor_weight", web: "monitor_weight" }, tint: colors.bronze, background: "#F4EDE0" },
  percent: { icon: { ios: "percent", android: "percent", web: "percent" }, tint: colors.danger, background: colors.dangerSoft },
  muscle: { icon: { ios: "dumbbell", android: "fitness_center", web: "fitness_center" }, tint: "#4A7FC1", background: "#E3EDF8" },
  fatMass: { icon: { ios: "circle.hexagongrid", android: "bubble_chart", web: "bubble_chart" }, tint: colors.warning, background: colors.warningSoft },
  leanMass: { icon: { ios: "figure.strengthtraining.traditional", android: "accessibility_new", web: "accessibility_new" }, tint: colors.leaf, background: colors.leafSoft },
  bmi: { icon: { ios: "person.crop.square", android: "straighten", web: "straighten" }, tint: "#4A7FC1", background: "#E3EDF8" },
  energy: { icon: { ios: "flame", android: "local_fire_department", web: "local_fire_department" }, tint: colors.danger, background: colors.dangerSoft },
  info: { icon: { ios: "info.circle", android: "info", web: "info" }, tint: colors.muted, background: colors.creamTab },
} satisfies Record<string, FieldLook>;

// Every number we read, in the order shown
const numberFields: { key: NumberField; label: string; unit: string; look: FieldLook }[] = [
  { key: "age", label: "Age", unit: "years", look: look.age },
  { key: "heightCm", label: "Height", unit: "cm", look: look.height },
  { key: "weightKg", label: "Weight", unit: "kg", look: look.weight },
  { key: "percentBodyFat", label: "Body Fat Percentage", unit: "%", look: look.percent },
  { key: "skeletalMuscleMassKg", label: "Skeletal Muscle Mass", unit: "kg", look: look.muscle },
  { key: "bodyFatMassKg", label: "Body Fat Mass", unit: "kg", look: look.fatMass },
  { key: "fatFreeMassKg", label: "Fat-free Mass", unit: "kg", look: look.leanMass },
  { key: "printedBmrKcal", label: "Printed BMR", unit: "kcal", look: look.energy },
  { key: "printedRecommendedIntakeKcal", label: "Printed intake", unit: "kcal", look: look.info },
];

const genderOptions: Option<EquationGender>[] = [
  { id: "male", label: "Male" },
  { id: "female", label: "Female" },
];

const toText = (value: number | null) => (value == null ? "" : String(value));
const toNumber = (text: string) => (text.trim() === "" || Number.isNaN(Number(text)) ? null : Number(text));
// "2026-09-01" ⇄ Date (UTC noon avoids timezone date shifts)
const isoToDate = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`) : new Date());
const dateToIso = (date: Date) => date.toISOString().slice(0, 10);

// BMI from the corrected weight and height, shown for reference only (never saved)
function bmiText(weightKg: number | null, heightCm: number | null) {
  if (!weightKg || !heightCm || weightKg <= 0 || heightCm <= 0) return "";
  return (weightKg / (heightCm / 100) ** 2).toFixed(1);
}

// "Review your details": every value read from the uploaded report, for the user to check
// and correct. Nothing is used for calculation until they continue.
export default function ReviewReport() {
  const { reportDraft, confirmReport, setReportDraft } = useSetupStore();
  const [values, setValues] = useState<Record<NumberField, string>>(() =>
    Object.fromEntries(numberFields.map(({ key }) => [key, toText(reportDraft?.[key] ?? null)])) as Record<NumberField, string>,
  );
  const [testDate, setTestDate] = useState(reportDraft?.testDate ?? null);
  const [gender, setGender] = useState<EquationGender | null>(reportDraft?.gender ?? null);
  const [isDateOpen, setIsDateOpen] = useState(false);
  const [isGenderOpen, setIsGenderOpen] = useState(false);

  if (!reportDraft) return <Redirect href="/setup/body-composition" />;

  // The report as currently corrected, checked as if confirmed
  const edited: BodyCompositionReport = {
    ...reportDraft,
    testDate,
    gender,
    ...(Object.fromEntries(numberFields.map(({ key }) => [key, toNumber(values[key])])) as Record<NumberField, number | null>),
    confirmed: true,
  };
  const issues = [...reportCompletenessIssues(edited), ...reportConsistencyIssues(edited)];
  const flagged = new Set(issues.flatMap((issue) => issue.fields));
  const isExpired = issues.length === 0 && reportStatus(edited).status === "expired";

  // Confirms the values. A sheet with a segmental analysis shows it next (in place of
  // this screen, so Back from there returns to the upload step); otherwise straight back.
  const handleContinue = () => {
    confirmReport({ ...edited, confirmedAt: new Date().toISOString() });
    if (hasSegmentalData(edited)) router.replace("/setup/segmental");
    else router.back();
  };

  // Back (or "enter manually"): drop the draft and return to the upload step
  const handleDiscard = () => {
    setReportDraft(null);
    router.back();
  };

  const setNumber = (key: NumberField, text: string) => setValues({ ...values, [key]: text.replace(/[^\d.]/g, "").slice(0, 6) });

  return (
    <SetupScreen
      step="report"
      title="Review your details"
      subtitle="We have extracted these values from your InBody report. Please check and edit if needed."
      onNext={handleContinue}
      nextLabel="Continue"
      canContinue={issues.length === 0}
      onBack={handleDiscard}
    >
      <View className="setup__note">
        <SymbolView
          name={{ ios: "doc.text.magnifyingglass", android: "task", web: "task" }}
          size={26}
          tintColor={colors.forest}
        />
        <View className="flex-1 gap-0.5">
          <Text className="setup__note-title">Values extracted from your report</Text>
          <Text className="setup__note-text">You can edit any value if it looks incorrect.</Text>
        </View>
      </View>

      {issues.length > 0 && (
        <View className="mt-4 gap-2">
          {issues.map((issue) => (
            <FormAlert key={issue.message} message={issue.message} />
          ))}
        </View>
      )}

      {isExpired && (
        <View className="setup__info mt-4">
          <SymbolView name={{ ios: "info.circle", android: "info", web: "info" }} size={16} tintColor={colors.forest} />
          <Text className="setup__card-text flex-1">
            {`This report is more than ${calculatorConfig.bodyComposition.maxReportAgeDays} days old, so we'll use the standard formula instead. Upload a newer report if you have one.`}
          </Text>
        </View>
      )}

      <View className="mt-4 gap-2.5">
        <ReviewRow
          label="Test date"
          {...look.date}
          placeholder="Select"
          value={testDate ? formatDob(testDate.split("-").reverse().join("/")) : ""}
          onPress={() => setIsDateOpen(true)}
          invalid={flagged.has("testDate")}
        />
        <ReviewRow
          label="Gender"
          {...look.gender}
          placeholder="Not shown"
          value={genderOptions.find((option) => option.id === gender)?.label ?? ""}
          onPress={() => setIsGenderOpen(true)}
        />
        {numberFields.map((field) => (
          <ReviewRow
            key={field.key}
            label={field.label}
            {...field.look}
            unit={field.unit}
            placeholder="—"
            value={values[field.key]}
            onChangeText={(text) => setNumber(field.key, text)}
            invalid={flagged.has(field.key)}
          />
        ))}
        <ReviewRow label="BMI" {...look.bmi} value={bmiText(toNumber(values.weightKg), toNumber(values.heightCm))} />
      </View>

      <View className="setup__info mt-4 items-center">
        <View className="h-7 w-7 items-center justify-center rounded-pill bg-cream-tab">
          <SymbolView name={{ ios: "info", android: "info", web: "info" }} size={14} tintColor={colors.muted} />
        </View>
        <Text className="setup__card-text flex-1">
          These values are from your InBody report. You can edit them if needed, or{" "}
          <Text className="auth__link" onPress={handleDiscard}>
            enter manually
          </Text>
          .
        </Text>
      </View>

      <DatePickerSheet
        visible={isDateOpen}
        title="Test date"
        value={isoToDate(testDate)}
        maximumDate={new Date()}
        onSelect={(date) => setTestDate(dateToIso(date))}
        onClose={() => setIsDateOpen(false)}
      />
      <SelectSheet
        visible={isGenderOpen}
        title="Gender on the report"
        options={genderOptions}
        selected={gender}
        onSelect={setGender}
        onClose={() => setIsGenderOpen(false)}
      />
    </SetupScreen>
  );
}
