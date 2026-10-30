import { Text, View } from "react-native";

type Point = { key: string; value: number };

type Props = {
  points: Point[];
  // How a value reads in the accessibility label and on the tallest bar
  format: (value: number) => string;
  // A short label under a column; return "" to leave it out (every nth for dense charts)
  label: (key: string, index: number) => string;
  color: string;
  height?: number;
};

// A bar chart drawn with plain views (no chart library): one column per point, heights relative
// to the largest value, the largest value printed above its bar
export function BarChart({ points, format, label, color, height = 120 }: Props) {
  const max = Math.max(...points.map((p) => p.value), 0);
  return (
    <View accessibilityRole="image" accessibilityLabel={points.map((p, i) => `${label(p.key, i) || p.key}: ${format(p.value)}`).join(", ")}>
      <View className="ai-chart" style={{ height }}>
        {points.map((p) => {
          const share = max > 0 ? p.value / max : 0;
          return (
            <View key={p.key} className="ai-chart__col">
              {max > 0 && p.value === max && <Text className="ai-chart__peak" numberOfLines={1}>{format(p.value)}</Text>}
              <View className="ai-chart__bar" style={{ height: Math.max(share * (height - 22), p.value > 0 ? 3 : 1), backgroundColor: p.value > 0 ? color : undefined }} />
            </View>
          );
        })}
      </View>
      <View className="flex-row">
        {points.map((p, i) => (
          <Text key={p.key} className="ai-chart__label" numberOfLines={1}>{label(p.key, i)}</Text>
        ))}
      </View>
    </View>
  );
}
