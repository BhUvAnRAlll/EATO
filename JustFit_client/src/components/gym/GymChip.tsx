import type { ReactNode } from "react";
import { Text, View, type LayoutChangeEvent, type PressableProps } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { GradientFill } from "@/components/gym/GradientFill";

// The portal's two chips (2026-11-08, one look everywhere): unselected is the white page with a
// grey outline and ink text; selected is the indigo gradient with white text. Both are at least
// 36 px tall and reach 44 px with their hitSlop.
const HIT_SLOP = { top: 4, bottom: 4, left: 2, right: 2 };

type ChipA11y = Pick<PressableProps, "accessibilityRole" | "accessibilityState" | "accessibilityLabel" | "accessibilityValue" | "disabled"> & {
  "aria-checked"?: boolean;
  "aria-disabled"?: boolean;
};

// A choice chip (Gender, Mode, a plan, a template). `children` go before the label (an icon);
// `trailing` (a price) follows it and never shrinks: a long name is cut, the price stays.
export function ChoiceChip({ label, trailing, selected, onPress, onLayout, children, style, ...a11y }: ChipA11y & {
  label: string;
  trailing?: string;
  selected: boolean;
  onPress: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  children?: ReactNode;
  style?: { opacity?: number; flex?: number };
}) {
  return (
    <PressableScale
      onPress={onPress}
      onLayout={onLayout}
      hitSlop={HIT_SLOP}
      className={selected ? "gym-kind gym-kind--selected flex-row items-center" : "gym-kind flex-row items-center"}
      style={{ gap: 6, maxWidth: "100%", ...style }}
      accessibilityLabel={trailing ? `${label}, ${trailing}` : label}
      {...a11y}
    >
      {selected && <GradientFill radius={999} />}
      {children}
      <Text className={selected ? "gym-kind__label gym-kind__label--selected" : "gym-kind__label"} numberOfLines={1} style={{ flexShrink: 1 }}>{label}</Text>
      {trailing ? <Text className={selected ? "gym-kind__label gym-kind__label--selected" : "gym-kind__label"} numberOfLines={1} style={{ flexShrink: 0 }}>{trailing}</Text> : null}
    </PressableScale>
  );
}

// A filter chip on a list screen (Members, Transactions, Enquiries…): the label and, when known,
// its count in a bubble, as on Members. Put them in one horizontally scrolling row.
export function FilterChip({ label, count, selected, onPress, onLayout, accessibilityLabel }: {
  label: string;
  count?: number | null;
  selected: boolean;
  onPress: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  accessibilityLabel?: string;
}) {
  const hasCount = count !== undefined && count !== null;
  return (
    <PressableScale
      onPress={onPress}
      onLayout={onLayout}
      hitSlop={HIT_SLOP}
      className={selected ? "gym-filter gym-filter--selected" : "gym-filter"}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityValue={hasCount ? { text: String(count) } : undefined}
      // The web build reads only the aria props: the tab's state and its count for screen readers
      aria-selected={selected}
      aria-valuetext={hasCount ? String(count) : undefined}
    >
      {selected && <GradientFill radius={999} />}
      <Text className={selected ? "gym-filter__label gym-filter__label--selected" : "gym-filter__label"} numberOfLines={1}>{label}</Text>
      {hasCount && (
        <View className={selected ? "gym-filter__count gym-filter__count--selected" : "gym-filter__count"}>
          <Text className={selected ? "gym-filter__count-label gym-filter__count-label--selected" : "gym-filter__count-label"}>{count}</Text>
        </View>
      )}
    </PressableScale>
  );
}
