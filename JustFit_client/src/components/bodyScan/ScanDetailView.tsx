import { Text, View } from "react-native";
import { Image } from "expo-image";

import { scanPhoto, type ScanDetail } from "@/lib/bodyScansApi";
import { scanReportRows, scanWhen } from "@/lib/bodyScanText";
import { useAuthStore } from "@/store/auth";

// One kept body scan: when, who it was for, the front and side photos and the report's numbers.
// Used by Super Admin › Body scans (as "admin") and the member's Profile › My body scans.
// The photos are read with the session token and never cached on the phone.
export function ScanDetailView({ scan, as }: { scan: ScanDetail; as: "member" | "admin" }) {
  const token = useAuthStore((state) => state.token);
  return (
    <View className="gap-3.5">
      <View className="card gap-1">
        <Text className="type-caption text-muted">{scanWhen(scan.at)}</Text>
        <Text className="setup__macro-value">{`${scan.bodyFatPercent}% body fat`}</Text>
        <Text className="type-body text-muted">{`${scan.sex === "male" ? "Male" : "Female"} · ${scan.age} y · ${scan.heightCm} cm · ${scan.weightKg} kg`}</Text>
      </View>

      <View className="flex-row gap-3">
        {(["front", "side"] as const).map((view) => {
          const source = scanPhoto(scan.id, view, token, as);
          return (
            <View key={view} className="flex-1 gap-1.5">
              <View className="overflow-hidden rounded-md bg-cream-deep" style={{ aspectRatio: 3 / 4 }}>
                {source && (
                  <Image source={source} cachePolicy="none" contentFit="cover" style={{ width: "100%", height: "100%" }} accessibilityLabel={`${view === "front" ? "Front" : "Side"} photo`} />
                )}
              </View>
              <Text className="type-caption text-center text-muted">{view === "front" ? "Front" : "Side"}</Text>
            </View>
          );
        })}
      </View>

      <View className="card py-1">
        {scanReportRows(scan.report).map((row, index, rows) => (
          <View key={row.label} className="list-row" style={index === rows.length - 1 ? { borderBottomWidth: 0 } : undefined}>
            <Text className="list-row__label flex-1">{row.label}</Text>
            <Text className="type-body text-forest-ink">{row.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
