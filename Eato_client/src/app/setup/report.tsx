import { useState } from "react";
import { Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { Redirect, router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { DatePickerSheet } from "@/components/setup/DatePickerSheet";
import { SelectSheet } from "@/components/setup/SelectSheet";
import { SetupField } from "@/components/setup/SetupField";
import { SetupScreen } from "@/components/setup/SetupScreen";
import { formatDob } from "@/lib/date";
import {
  calculatorConfig,
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
  | "bodyFatMassKg"
  | "percentBodyFat"
  | "fatFreeMassKg"
  | "skeletalMuscleMassKg"
  | "printedBmrKcal"
  | "printedRecommendedIntakeKcal";

// Every value we read, in the order it appears on most sheets
const numberFields: { key: NumberField; label: string; unit: string; icon: Icon }[] = [
  { key: "age", label: "Age", unit: "years", icon: { ios: "birthday.cake", android: "cake", web: "cake" } },
  { key: "heightCm", label: "Height", unit: "cm", icon: { ios: "ruler", android: "height", web: "height" } },
  { key: "weightKg", label: "Weight", unit: "kg", icon: { ios: "scalemass", android: "scale", web: "scale" } },
  { key: "bodyFatMassKg", label: "Body fat mass", unit: "kg", icon: { ios: "drop", android: "opacity", web: "opacity" } },
  { key: "percentBodyFat", label: "Percent body fat (PBF)", unit: "%", icon: { ios: "percent", android: "percent", web: "percent" } },
  { key: "fatFreeMassKg", label: "Fat-free mass", unit: "kg", icon: { ios: "figure.strengthtraining.traditional", android: "fitness_center", web: "fitness_center" } },
  { key: "skeletalMuscleMassKg", label: "Skeletal muscle mass", unit: "kg", icon: { ios: "dumbbell", android: "fitness_center", web: "fitness_center" } },
  { key: "printedBmrKcal", label: "Basal metabolic rate (printed)", unit: "kcal", icon: { ios: "flame", android: "local_fire_department", web: "local_fire_department" } },
  {
    key: "printedRecommendedIntakeKcal",
    label: "Recommended calorie intake (device reference only)",
    unit: "kcal",
    icon: { ios: "info.circle", android: "info", web: "info" },
  },
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

// Shows every value read from the uploaded report for the user to check and correct.
// Nothing is used for calculation until they confirm.
export default function ConfirmReport() {
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

  const handleConfirm = () => {
    confirmReport({ ...edited, confirmedAt: new Date().toISOString() });
    router.back();
  };

  const handleDiscard = () => {
    setReportDraft(null);
    router.back();
  };

  return (
    <SetupScreen
      step="body-composition"
      title="Check your report"
      subtitle="We read these values from your report. Compare each one with the sheet and fix anything that's wrong or empty."
      onNext={handleConfirm}
      nextLabel="Confirm values"
      canContinue={issues.length === 0}
      onBack={handleDiscard}
    >
      {issues.length > 0 && (
        <View className="mb-4 gap-2">
          {issues.map((issue) => (
            <FormAlert key={issue.message} message={issue.message} />
          ))}
        </View>
      )}

      {isExpired && (
        <View className="setup__info mb-4">
          <SymbolView name={{ ios: "info.circle", android: "info", web: "info" }} size={16} tintColor={colors.forest} />
          <Text className="setup__card-text flex-1">
            {`This report is more than ${calculatorConfig.bodyComposition.maxReportAgeDays} days old, so we'll use the standard formula instead. Upload a newer report if you have one.`}
          </Text>
        </View>
      )}

      <View className="gap-3">
        <SetupField
          label="Test date"
          icon={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }}
          placeholder="Select the date on the report"
          value={testDate ? formatDob(testDate.split("-").reverse().join("/")) : ""}
          onPress={() => setIsDateOpen(true)}
          trailingIcon={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }}
          invalid={flagged.has("testDate")}
        />
        <SetupField
          label="Gender"
          icon={{ ios: "figure.stand", android: "wc", web: "wc" }}
          placeholder="Not shown"
          value={genderOptions.find((option) => option.id === gender)?.label ?? ""}
          onPress={() => setIsGenderOpen(true)}
        />
        {numberFields.map((field) => (
          <SetupField
            key={field.key}
            label={field.label}
            icon={field.icon}
            unit={field.unit}
            placeholder="Couldn't read, type it from the sheet"
            value={values[field.key]}
            onChangeText={(text) => setValues({ ...values, [field.key]: text.replace(/[^\d.]/g, "").slice(0, 6) })}
            keyboardType="decimal-pad"
            invalid={flagged.has(field.key)}
          />
        ))}
      </View>

      <Text className="setup__card-text mt-4">
        Body composition readings vary with hydration, meals and time of day, so results are estimates.
      </Text>
      <Text className="auth__link mt-3" onPress={handleDiscard}>
        {"Discard report and enter my details manually"}
      </Text>

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
