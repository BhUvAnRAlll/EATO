import { useState } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";

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

// Room for "12 Nov" at 10 px (a shorter label takes a narrower box, so seven weekday letters all
// fit at 320 px), and for the largest value above its bar
const LABEL_WIDTH = 44;
const boxFor = (text: string) => Math.min(LABEL_WIDTH, text.length * 7 + 6);
const PEAK_WIDTH = 96;
// The line above the bars where the largest value is printed
const PEAK_ROOM = 22;

// A bar chart drawn with plain views (no chart library): one column per point, heights relative
// to the largest value, the largest value printed above its bar. Many bars (24 hours, 30 or 90
// days) sit edge to edge; the labels under them are the caller's, thinned so that no two overlap
// and none is cut short, each centred under its bar (so the label row always lines up with the
// bar row, at 320 px too).
export function BarChart({ points, format, label, color, height = 120 }: Props) {
  const [width, setWidth] = useState(0);
  const max = Math.max(...points.map((p) => p.value), 0);
  const gap = points.length > 14 ? 0 : 3;
  const col = width > 0 && points.length > 0 ? (width - gap * (points.length - 1)) / points.length : 0;
  const centre = (index: number) => index * (col + gap) + col / 2;
  // A box of boxWidth centred under a column, kept inside the chart
  const place = (index: number, boxWidth: number) => Math.min(Math.max(centre(index) - boxWidth / 2, 0), Math.max(width - boxWidth, 0));

  const labels: { index: number; text: string; box: number }[] = [];
  if (width > 0) {
    let lastRight = -Infinity;
    points.forEach((p, i) => {
      const text = label(p.key, i);
      if (!text) return;
      const box = boxFor(text);
      const left = place(i, box);
      if (left < lastRight) return;
      labels.push({ index: i, text, box });
      lastRight = left + box;
    });
  }
  const peak = max > 0 ? points.findIndex((p) => p.value === max) : -1;

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={points.map((p, i) => `${label(p.key, i) || p.key}: ${format(p.value)}`).join(", ")}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
    >
      <View className="ai-chart" style={{ height, gap }}>
        {points.map((p) => {
          const share = max > 0 ? p.value / max : 0;
          return (
            <View key={p.key} className="ai-chart__col">
              <View className="ai-chart__bar" style={{ height: Math.max(share * (height - PEAK_ROOM), p.value > 0 ? 3 : 1), backgroundColor: p.value > 0 ? color : undefined }} />
            </View>
          );
        })}
        {peak >= 0 && width > 0 && (
          <Text className="ai-chart__peak" numberOfLines={1} style={{ position: "absolute", top: 0, left: place(peak, PEAK_WIDTH), width: PEAK_WIDTH, textAlign: "center" }}>
            {format(max)}
          </Text>
        )}
      </View>
      <View style={{ height: 14 }}>
        {labels.map((l) => (
          <Text key={points[l.index].key} className="ai-chart__label" numberOfLines={1} style={{ position: "absolute", top: 0, left: place(l.index, l.box), width: l.box, textAlign: "center" }}>
            {l.text}
          </Text>
        ))}
      </View>
    </View>
  );
}
