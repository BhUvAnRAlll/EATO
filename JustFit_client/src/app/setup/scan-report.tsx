import { useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";
import { Redirect, router, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { BodyFatGauge, Pill, ScoreRing, StackedBar, ZoneRow, type Part, type Tone } from "@/components/setup/ReportGraphs";
import { SegmentalChart } from "@/components/setup/SegmentalChart";
import { SetupScreen } from "@/components/setup/SetupScreen";
import {
  bodyFatCategory,
  isCompleteEstimate,
  changeText,
  rangeStatus,
  reportBarScales,
  visceralStatus,
  type BodyFatCategory,
  type RegionReadings,
  type RegionStatus,
  type VisceralStatus,
} from "@/lib/bodyScanRules";
import type { BodySegment, SegmentReading } from "@/lib/nutrition";
import { fetchProfile, saveProfile } from "@/lib/profile";
import { bodyFatSave } from "@/lib/profileScan";
import { SESSION_EXPIRED_MESSAGE, isSessionExpired, useSessionToken } from "@/lib/session";
import { useSetupStore } from "@/store/setup";
import { useThemeColors } from "@/theme";

const kcal = (value: number) => `${value.toLocaleString("en-IN")} kcal`;

// Verdict → pill text and colour, matching the scan's own report
const statusPill: Record<RegionStatus, { label: string; tone: Tone }> = {
  under: { label: "Under", tone: "info" },
  normal: { label: "Normal", tone: "good" },
  over: { label: "Over", tone: "bad" },
};
const categoryPill: Record<BodyFatCategory, { label: string; tone: Tone }> = {
  low: { label: "Low", tone: "info" },
  healthy: { label: "Healthy", tone: "good" },
  elevated: { label: "Elevated", tone: "warn" },
  high: { label: "High", tone: "bad" },
};
const visceralPill: Record<VisceralStatus, { label: string; tone: Tone }> = {
  low: { label: "Low", tone: "good" },
  normal: { label: "Normal", tone: "good" },
  high: { label: "High", tone: "bad" },
};

// A titled card, with an optional muted line under the title
function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <View className="setup__card gap-1">
      <Text className="setup__card-title">{title}</Text>
      {subtitle && <Text className="setup__card-text mb-2">{subtitle}</Text>}
      {children}
    </View>
  );
}

// Label / value rows; rows without a value are left out
function Rows({ rows }: { rows: { label: string; value: string | null }[] }) {
  const shown = rows.filter((row): row is { label: string; value: string } => row.value !== null);
  return shown.map((row, index) => (
    <View key={row.label} className="report__row" style={index === shown.length - 1 ? { borderBottomWidth: 0 } : undefined}>
      <Text className="report__label">{row.label}</Text>
      <Text className="report__value">{row.value}</Text>
    </View>
  ));
}

function Kpi({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <View className="report__kpi">
      <Text className="setup__card-text">{label}</Text>
      <Text className="report__kpi-value">
        {value.toFixed(1)}
        {unit && <Text className="report__unit">{` ${unit}`}</Text>}
      </Text>
    </View>
  );
}

function Tile({ label, value, pill, hint }: { label: string; value: string; pill: { label: string; tone: Tone }; hint: string }) {
  return (
    <View className="report__tile">
      <Text className="setup__card-text">{label}</Text>
      <Text className="report__kpi-value">{value}</Text>
      <Pill label={pill.label} tone={pill.tone} />
      <Text className="report__tick">{hint}</Text>
    </View>
  );
}

// The scan's region readings in the shape the segmental chart draws
const toSegments = (readings: RegionReadings): Record<BodySegment, SegmentReading> => ({
  leftArm: { kg: readings.leftArm.kg, rating: readings.leftArm.status },
  rightArm: { kg: readings.rightArm.kg, rating: readings.rightArm.status },
  trunk: { kg: readings.trunk.kg, rating: readings.trunk.status },
  leftLeg: { kg: readings.leftLeg.kg, rating: readings.leftLeg.status },
  rightLeg: { kg: readings.rightLeg.kg, rating: readings.rightLeg.status },
});

const scanTime = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

// The body composition report from a scan, laid out like the scan's own report in the light
// theme. Opened right after scanning (accept or retake) or later from the Body composition step
// (?mode=view), or from Profile (?from=profile), where "Save to my profile" first shows what
// changes and then saves. It is shown in the app only: there is no download or share.
// Screenshots and screen recordings are allowed (the user asked for this on 2026-10-25).
export default function ScanReport() {
  const colors = useThemeColors();
  const { mode, from } = useLocalSearchParams<{
    mode?: string;
    from?: string;
  }>();
  const viewing = mode === "view";
  const fromProfile = from === "profile";
  const home = fromProfile ? "/profile" : "/setup/body-composition";
  const { scanDraft, scan, acceptScan } = useSetupStore();
  const result = viewing ? scan : scanDraft;
  const getToken = useSessionToken();
  // From Profile: the save, once worked out, waits here for the user to confirm it
  const [pendingSave, setPendingSave] = useState<Extract<ReturnType<typeof bodyFatSave>, { ok: true }> | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Nothing to show (a reload or a direct link), or an incomplete result: back to where the scan started
  if (!result || !isCompleteEstimate(result)) return <Redirect href={home} />;
  const r = result.report;
  const bf = result.percentBodyFat;
  const healthy = r.healthy;

  const parts: Part[] = [
    { label: "Fat", kg: r.fatMassKg ?? 0, color: colors.warning },
    { label: "Water", kg: r.bodyWaterKg ?? 0, color: colors.info },
    { label: "Protein", kg: r.proteinKg ?? 0, color: colors.protein },
    { label: "Minerals", kg: r.mineralsKg ?? 0, color: colors.faint },
  ].filter((part) => part.kg > 0);

  const useResult = () => {
    acceptScan();
    router.dismissTo("/setup/body-composition");
  };

  // From Profile, first tap: read the latest saved profile and work out the save (the new body
  // fat % and recalculated targets), shown above for the user to confirm
  const prepareSave = async () => {
    if (isSaving) return;
    setSaveError(null);
    setIsSaving(true);
    const current = await fetchProfile(await getToken());
    setIsSaving(false);
    if (!current.ok) return setSaveError(isSessionExpired(current) ? SESSION_EXPIRED_MESSAGE : current.error);
    const save = bodyFatSave(current.data.profile, current.data.nutrition, bf);
    if (!save.ok) return setSaveError(save.error);
    setPendingSave(save);
  };

  // Second tap: save it, keep the report viewable this session, and return to Profile
  const confirmSave = async () => {
    if (!pendingSave || isSaving) return;
    setSaveError(null);
    setIsSaving(true);
    const saved = await saveProfile(await getToken(), pendingSave.body);
    setIsSaving(false);
    if (!saved.ok) return setSaveError(isSessionExpired(saved) ? SESSION_EXPIRED_MESSAGE : saved.error);
    acceptScan();
    router.dismissTo("/profile");
  };

  const onNext = viewing ? () => router.back() : fromProfile ? (pendingSave ? confirmSave : prepareSave) : useResult;
  const nextLabel = viewing ? "Done" : fromProfile ? (pendingSave ? "Confirm and save" : "Save to my profile") : "Use this result";

  return (
    <SetupScreen
      step="body-composition"
      title="Body Composition Report"
      subtitle="From your body scan."
      onNext={onNext}
      nextLabel={nextLabel}
      loading={isSaving}
      // While a save waits for confirmation, Back returns to the report instead
      onBack={() => (pendingSave ? setPendingSave(null) : router.canGoBack() ? router.back() : router.replace(home))}
      showProgress={!fromProfile}
    >
      {saveError && (
        <View className="mb-3">
          <FormAlert message={saveError} />
        </View>
      )}
      {pendingSave ? (
        <View className="setup__card setup__card--selected gap-1.5" accessibilityRole="summary">
          <Text className="setup__card-title">Save this result?</Text>
          {pendingSave.changes.map((line) => (
            <Text key={line} className="setup__card-text">
              {line}
            </Text>
          ))}
        </View>
      ) : (
        <View className="gap-3">
          <View className="report__chips">
            {[scanTime.format(new Date()), `${r.sex === "male" ? "Male" : "Female"} · ${r.age} y`, `${r.heightCm} cm`, `${r.weightKg.toFixed(1)} kg`].map(
              (chip) => (
                <View key={chip} className="report__chip">
                  <Text className="report__chip-label">{chip}</Text>
                </View>
              ),
            )}
          </View>

          {/* Hero: body fat on its gauge, the key numbers and the body score */}
          <View className="setup__card gap-3">
            <View>
              <Text className="report__eyebrow">ESTIMATED BODY FAT</Text>
              <Text className="report__hero">
                {bf.toFixed(1)}
                <Text className="report__hero-unit">%</Text>
              </Text>
              <Pill {...categoryPill[bodyFatCategory(bf, healthy.bodyFatPercent)]} />
              <BodyFatGauge value={bf} healthy={healthy.bodyFatPercent} />
            </View>
            <View className="flex-row gap-2">
              {r.fatMassKg !== null && <Kpi label="Fat mass" value={r.fatMassKg} unit="kg" />}
              {r.leanMassKg !== null && <Kpi label="Lean mass" value={r.leanMassKg} unit="kg" />}
            </View>
            <View className="flex-row gap-2">
              {r.skeletalMuscleKg !== null && <Kpi label="Skeletal muscle" value={r.skeletalMuscleKg} unit="kg" />}
              {r.bmi !== null && <Kpi label="BMI" value={r.bmi} />}
            </View>
            {r.score !== null && (
              <View className="report__kpi flex-row items-center gap-4">
                <ScoreRing value={r.score} delay={150} />
                <View className="flex-1">
                  <Text className="setup__card-title">Body score</Text>
                  <Text className="setup__card-text">Out of 100.</Text>
                </View>
              </View>
            )}
          </View>

          {parts.length > 1 && (
            <Card title={`What your ${r.weightKg.toFixed(1)} kg is made of`} subtitle="Estimated split of body weight">
              <StackedBar parts={parts} totalKg={r.weightKg} delay={250} />
              {r.leanMassKg !== null && (
                <View className="report__lean">
                  <Text className="report__label">Lean body mass (everything except fat)</Text>
                  <Text className="report__value">{`${r.leanMassKg.toFixed(1)} kg`}</Text>
                </View>
              )}
            </Card>
          )}

          <Card title="Muscle and fat" subtitle="The shaded band is the healthy range for you">
            <ZoneRow
              label="Weight"
              value={r.weightKg}
              unit="kg"
              healthy={healthy.weightKg}
              scale={reportBarScales.weightKg}
              pill={statusPill[rangeStatus(r.weightKg, healthy.weightKg)]}
              delay={400}
            />
            {r.skeletalMuscleKg !== null && (
              <ZoneRow
                label="Skeletal muscle"
                value={r.skeletalMuscleKg}
                unit="kg"
                healthy={healthy.skeletalMuscleKg}
                scale={reportBarScales.skeletalMuscleKg}
                pill={statusPill[rangeStatus(r.skeletalMuscleKg, healthy.skeletalMuscleKg)]}
                delay={500}
              />
            )}
            {r.fatMassKg !== null && (
              <ZoneRow
                label="Fat mass"
                value={r.fatMassKg}
                unit="kg"
                healthy={healthy.fatMassKg}
                scale={reportBarScales.fatMassKg}
                pill={statusPill[rangeStatus(r.fatMassKg, healthy.fatMassKg)]}
                delay={600}
              />
            )}
            <ZoneRow
              label="Body fat"
              value={bf}
              unit="%"
              healthy={healthy.bodyFatPercent}
              scale={reportBarScales.bodyFatPercent}
              pill={statusPill[rangeStatus(bf, healthy.bodyFatPercent)]}
              delay={700}
            />
          </Card>

          <View className="flex-row flex-wrap justify-between gap-y-2.5">
            {r.bmi !== null && (
              <Tile
                label="BMI"
                value={r.bmi.toFixed(1)}
                pill={statusPill[rangeStatus(r.bmi, healthy.bmi)]}
                hint={`Healthy ${healthy.bmi[0]}–${healthy.bmi[1]}`}
              />
            )}
            {r.waistToHeight !== null && (
              <Tile
                label="Waist-to-height"
                value={r.waistToHeight.toFixed(2)}
                pill={statusPill[rangeStatus(r.waistToHeight, healthy.waistToHeight)]}
                hint={`${r.waistCm !== null ? `Est. waist ${Math.round(r.waistCm)} cm · ` : ""}healthy ${healthy.waistToHeight[0].toFixed(2)}–${healthy.waistToHeight[1].toFixed(2)}`}
              />
            )}
            {r.visceralFatLevel !== null && (
              <Tile
                label="Visceral fat level"
                value={`${r.visceralFatLevel} / 20`}
                pill={visceralPill[visceralStatus(r.visceralFatLevel)]}
                hint="Lower is better"
              />
            )}
            <Tile
              label="Body fat"
              value={`${bf.toFixed(1)}%`}
              pill={statusPill[rangeStatus(bf, healthy.bodyFatPercent)]}
              hint={`Healthy ${healthy.bodyFatPercent[0]}–${healthy.bodyFatPercent[1]}% for ${r.sex === "male" ? "males" : "females"}`}
            />
          </View>

          {r.leanByRegion && (
            <SegmentalChart
              title="Segmental lean mass"
              icon={{
                ios: "dumbbell.fill",
                android: "fitness_center",
                web: "fitness_center",
              }}
              tint={colors.leaf}
              background={colors.leafSoft}
              readings={toSegments(r.leanByRegion)}
              mirrored
              delay={900}
            />
          )}
          {r.fatByRegion && (
            <SegmentalChart
              title="Segmental fat"
              icon={{ ios: "percent", android: "percent", web: "percent" }}
              tint={colors.danger}
              background={colors.dangerSoft}
              readings={toSegments(r.fatByRegion)}
              mirrored
              delay={1100}
            />
          )}

          <Card title="Targets" subtitle="Toward the healthy range">
            <Rows
              rows={[
                {
                  label: "Target weight",
                  value: r.targetWeightKg === null ? null : `${r.targetWeightKg.toFixed(1)} kg`,
                },
                {
                  label: "Weight change",
                  value: r.weightChangeKg === null ? null : changeText(r.weightChangeKg),
                },
                {
                  label: "Fat change",
                  value: r.fatChangeKg === null ? null : changeText(r.fatChangeKg),
                },
                {
                  label: "Muscle change",
                  value: r.muscleChangeKg === null ? null : changeText(r.muscleChangeKg),
                },
              ]}
            />
          </Card>

          <Card title="Daily energy" subtitle="Estimated from lean mass">
            <Rows
              rows={[
                {
                  label: "Resting (BMR)",
                  value: r.bmrKcal === null ? null : kcal(r.bmrKcal),
                },
                {
                  label: "Total with activity (TDEE)",
                  value: r.dailyEnergyKcal === null ? null : kcal(r.dailyEnergyKcal),
                },
                {
                  label: "Suggested intake for fat loss",
                  value: r.suggestedIntakeKcal === null ? null : kcal(r.suggestedIntakeKcal),
                },
              ]}
            />
          </Card>

          <View className="setup__note">
            <SymbolView name={{ ios: "lock.shield", android: "shield", web: "shield" }} size={22} tintColor={colors.leaf} />
            <View className="flex-1 gap-0.5">
              <Text className="setup__note-title">Private to you</Text>
              <Text className="setup__note-text">
                {"This report stays in the app. It can't be downloaded or shared. Photo-based estimate, not a medical measurement."}
              </Text>
            </View>
          </View>
        </View>
      )}
    </SetupScreen>
  );
}
