import { View } from "react-native";

import { ChoiceChip } from "@/components/gym/GymChip";
import { DateSelect } from "@/components/gym/DateSelect";
import { daysFromToday } from "@/data/gymDashboard";
import { haptic } from "@/lib/haptics";

const QUICK = [
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "1 month", days: 30 },
];

// "Pay the rest by": the date an amount still owed should be paid by, from today to a year ahead.
// Quick picks (1 week, 2 weeks, 1 month) or Select for any date.
export function DueByField({ value, onChange, label = "Pay the rest by" }: { value: string | null; onChange: (iso: string) => void; label?: string }) {
  return (
    <View style={{ gap: 8 }}>
      <DateSelect label={label} value={value} onChange={onChange} min={daysFromToday(0)} max={daysFromToday(365)} />
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {QUICK.map((q) => {
          const iso = daysFromToday(q.days);
          const selected = iso === value;
          return (
            <ChoiceChip key={q.label} onPress={() => { haptic.select(); onChange(iso); }} selected={selected} label={`In ${q.label}`} accessibilityRole="button" accessibilityState={{ selected }} />
          );
        })}
      </View>
    </View>
  );
}
