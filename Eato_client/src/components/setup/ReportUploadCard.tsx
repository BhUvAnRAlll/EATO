import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { router } from "expo-router";
import { useAuth, useClerk } from "@clerk/expo";

import { FormAlert } from "@/components/FormAlert";
import { formatDob } from "@/lib/date";
import { resolveFatFreeMass } from "@/lib/nutrition";
import { pickReport, readReport, type ReportSource } from "@/lib/reportUpload";
import { SESSION_EXPIRED_MESSAGE, isSessionExpired, returnToSignIn } from "@/lib/session";
import { useSetupStore } from "@/store/setup";
import { colors } from "@/theme";
import type { Icon } from "@/types/profile";

// Quick-pick tiles under "Choose file"
const uploadOptions: { source: ReportSource; label: string; icon: Icon }[] = [
  { source: "camera", label: "Take photo", icon: { ios: "camera", android: "photo_camera", web: "photo_camera" } },
  { source: "library", label: "Choose from gallery", icon: { ios: "doc.text", android: "description", web: "description" } },
  { source: "pdf", label: "Upload PDF", icon: { ios: "doc.richtext", android: "picture_as_pdf", web: "picture_as_pdf" } },
];

// "2026-09-01" → "1 Sep 2026"
const formatTestDate = (iso: string | null) => (iso ? formatDob(iso.split("-").reverse().join("/")) : "");

function Value({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1">
      <Text className="setup__card-text">{label}</Text>
      <Text className="setup__macro-value">{value}</Text>
    </View>
  );
}

// Upload card (photo or PDF) for the body composition screen. Once a report is
// confirmed it shows a summary with Review / Remove instead.
export function ReportUploadCard() {
  const { getToken } = useAuth();
  const { signOut } = useClerk();
  const { report, setReportDraft, removeReport } = useSetupStore();
  const [isReading, setIsReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The server rejected the session: offer the way back to sign-in instead of a dead retry
  const [sessionExpired, setSessionExpired] = useState(false);

  const upload = async (source: ReportSource) => {
    setError(null);
    setSessionExpired(false);
    const picked = await pickReport(source);
    if (!picked.ok) {
      if ("error" in picked) setError(picked.error);
      return;
    }
    setIsReading(true);
    const result = await readReport(picked.file, await getToken());
    setIsReading(false);
    if (!result.ok) {
      if (isSessionExpired(result)) setSessionExpired(true);
      return setError(isSessionExpired(result) ? SESSION_EXPIRED_MESSAGE : result.error);
    }
    setReportDraft(result.report);
    router.push("/setup/report");
  };

  const chooseSource = () =>
    Alert.alert("Upload body composition report", "InBody, Tanita or similar BCA report", [
      { text: "Take a photo", onPress: () => upload("camera") },
      { text: "Choose a photo", onPress: () => upload("library") },
      { text: "Choose a PDF", onPress: () => upload("pdf") },
      { text: "Cancel", style: "cancel" },
    ]);

  if (isReading) {
    return (
      <View className="setup__card items-center gap-3 py-8">
        <ActivityIndicator color={colors.forest} />
        <Text className="setup__card-text text-center">Reading your report. This can take a few seconds…</Text>
      </View>
    );
  }

  // Confirmed report: key values with review / remove
  if (report) {
    const fatFreeMass = resolveFatFreeMass(report);
    return (
      <View className="setup__card setup__card--selected gap-4">
        <View className="flex-row items-center gap-3">
          <SymbolView name={{ ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" }} size={22} tintColor={colors.forest} />
          <View className="flex-1">
            <Text className="setup__card-title">Report added</Text>
            <Text className="setup__card-text">Tested {formatTestDate(report.testDate)}</Text>
          </View>
        </View>
        <View className="flex-row gap-3">
          <Value label="Weight" value={report.weightKg != null ? `${report.weightKg} kg` : "—"} />
          <Value label="Body fat" value={report.percentBodyFat != null ? `${report.percentBodyFat}%` : "—"} />
          <Value label="Fat-free mass" value={fatFreeMass != null ? `${Math.round(fatFreeMass * 10) / 10} kg` : "—"} />
        </View>
        <View className="flex-row gap-5">
          <Text
            className="auth__link"
            onPress={() => {
              setReportDraft({ ...report, confirmed: false });
              router.push("/setup/report");
            }}
          >
            Review values
          </Text>
          <Text className="auth__link" onPress={removeReport}>
            Remove report
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="gap-3">
      <View className="upload__card">
        <View className="upload__icon">
          <SymbolView name={{ ios: "icloud.and.arrow.up", android: "cloud_upload", web: "cloud_upload" }} size={36} tintColor={colors.forest} />
        </View>
        <Text className="upload__title mt-1">Upload body composition report</Text>
        <Text className="upload__text mt-1.5">InBody, Tanita or similar BCA report</Text>
        <Text className="upload__hint mt-2.5">Photo or PDF (max 10 MB)</Text>

        <Pressable onPress={chooseSource} className="upload__button mt-4">
          <SymbolView name={{ ios: "photo", android: "image", web: "image" }} size={19} tintColor={colors.white} />
          <Text className="btn-forest__label">Choose file</Text>
        </Pressable>

        <View className="mt-3.5 flex-row items-center gap-4 self-stretch px-8">
          <View className="upload__divider-line" />
          <Text className="upload__hint">or</Text>
          <View className="upload__divider-line" />
        </View>

        <View className="mt-3.5 flex-row gap-2 self-stretch">
          {uploadOptions.map((option) => (
            <Pressable key={option.source} onPress={() => upload(option.source)} className="upload__option">
              <SymbolView name={option.icon} size={20} tintColor={colors.forestInk} />
              <Text className="upload__option-label">{option.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {error && <FormAlert message={error} />}
      {sessionExpired && (
        <Pressable onPress={() => returnToSignIn(signOut)} className="btn-outline">
          <Text className="btn-outline__label">Sign in again</Text>
        </Pressable>
      )}
    </View>
  );
}
