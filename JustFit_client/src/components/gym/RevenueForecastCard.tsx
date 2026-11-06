import { Text, View } from "react-native";

import { GymError } from "@/components/gym/GymStates";
import { rupees, shortDate } from "@/data/gymDashboard";
import type { RevenueForecast } from "@/lib/gymApi";
import type { GymLoad } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

const percent = (rate: number) => `${Math.round(rate * 100)}%`;

// Wallet › Expected by month end: the server's forecast (GET /api/gym/predictions/revenue) with
// each part and how it was reached, so the owner can see what is real money and what is an
// estimate. A part without enough history says so instead of showing a number.
export function RevenueForecastCard({ result, onRetry }: { result: GymLoad<RevenueForecast>; onRetry: () => void }) {
  const colors = useThemeColors();
  if (result.state === "loading") {
    return (
      <View className="gym-card p-4">
        <Text className="gym-tx__meta">Working out the month-end estimate…</Text>
      </View>
    );
  }
  if (result.state === "failed") return <GymError error={result.error} onRetry={onRetry} />;
  const d = result.data;
  const { renewals, dues } = d;

  const renewalLine =
    renewals.expiring === 0
      ? "No plans end before month end."
      : renewals.rate === null
        ? `${renewals.expiring} ${renewals.expiring === 1 ? "plan ends" : "plans end"} this month. Needs renewal history: a rate is used once 5 plans have ended (${renewals.sample.renewed + renewals.sample.lapsed} so far).`
        : `${renewals.expiring} ${renewals.expiring === 1 ? "plan ends" : "plans end"} this month · about ${percent(renewals.rate)} renew (${renewals.sample.renewed} of ${renewals.sample.renewed + renewals.sample.lapsed} in 90 days)${renewals.priced < renewals.expiring ? ` · ${renewals.expiring - renewals.priced} without a plan price` : ""}`;
  const duesLine =
    dues.outstanding === 0
      ? "No dues fall in this month."
      : dues.rate === null
        ? `${rupees(dues.outstanding)} due. Needs due history: a rate is used once some dues have been paid or have gone past their date.`
        : `${rupees(dues.outstanding)} due · about ${percent(dues.rate)} usually collected (${rupees(dues.sample.paid)} paid, ${rupees(dues.sample.overdue)} overdue, in 90 days)`;

  const rows: { label: string; note: string; amount: number | null }[] = [
    { label: "Collected so far", note: `${shortDate(d.month.from)} to today`, amount: d.collected },
    { label: "Likely renewals", note: renewalLine, amount: renewals.amount },
    { label: "Likely dues collected", note: duesLine, amount: dues.amount },
  ];

  return (
    <View className="gym-card p-4" style={{ gap: 12 }} accessible accessibilityLabel={`Expected by month end: ${d.complete ? "about" : "at least"} ${rupees(d.expected)}`}>
      <View>
        <Text className="gym-section-title">Expected by month end</Text>
        <Text className="gym-tx__amount" style={{ fontSize: 24, lineHeight: 32 }}>{`${d.complete ? "≈" : "≥"} ${rupees(d.expected)}`}</Text>
        <Text className="gym-tx__meta">{d.complete ? "An estimate from this branch's own records, not a promise." : "A partial estimate: one part has too little history yet (see below)."}</Text>
      </View>
      {rows.map((row) => (
        <View key={row.label} className="flex-row" style={{ gap: 10 }}>
          <View className="min-w-0 flex-1">
            <Text className="gym-tx__name">{row.label}</Text>
            <Text className="gym-tx__meta">{row.note}</Text>
          </View>
          <Text className="gym-tx__name" style={row.amount === null ? { color: colors.gymFaint } : undefined}>{row.amount === null ? "—" : rupees(row.amount)}</Text>
        </View>
      ))}
      <Text className="gym-tx__meta">{`Last month: ${rupees(d.lastMonth)} · ${d.month.daysLeft} ${d.month.daysLeft === 1 ? "day" : "days"} left · worked out just now`}</Text>
    </View>
  );
}
