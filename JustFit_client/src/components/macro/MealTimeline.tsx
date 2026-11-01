import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { SymbolView } from "@/components/SymbolView";
import { clockTime, slotInfo, whole, type Meal, type Slot } from "@/lib/macro";
import { useThemeColors } from "@/theme";

// The day's meals down a timeline, in the look of the coach's Meal Plan (the same `coach__tl-*`
// and `coach__meal-card` utilities): the time column (slot icon, time, red dot, dashed line)
// beside a card with the slot, the dish, its foods, calories and P / C / F chips. A logged meal
// opens its detail sheet; an unlogged slot on today carries a red Log Meal button into Add meal.

// The timeline's slot order (snack sits between lunch and dinner)
const timelineSlots: Slot[] = ["breakfast", "lunch", "snack", "dinner"];

export type TimelineRow = { slot: Slot; meal: Meal | null };

// Every slot shows: each logged meal in it, or one "Not logged yet" row
export function timelineRows(meals: Meal[]): TimelineRow[] {
  return timelineSlots.flatMap((slot): TimelineRow[] => {
    const logged = meals.filter((m) => m.slot === slot);
    return logged.length ? logged.map((meal) => ({ slot, meal })) : [{ slot, meal: null }];
  });
}

// ["08:00", "AM"] for the time column, from a logged meal's timestamp or a slot's usual time
function clockParts(hour: number, minute: number): [string, string] {
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return [`${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, hour < 12 ? "AM" : "PM"];
}

type Props = {
  rows: TimelineRow[];
  onOpen: (meal: Meal) => void;
  // Opens Add meal with the slot chosen; left out on a past day (nothing can be logged there)
  onAdd?: (slot: Slot) => void;
};

// One entry: the time column beside whatever the entry holds
function Entry({ slot, time, last, children }: { slot: Slot; time: [number, number]; last: boolean; children: ReactNode }) {
  const info = slotInfo[slot];
  const [clock, meridiem] = clockParts(...time);
  return (
    <View className="flex-row" style={{ gap: 12 }}>
      <View className="coach__tl-col" accessibilityLabel={`${info.label} at ${clock} ${meridiem}`}>
        <View className="coach__tl-icon" style={{ backgroundColor: `${info.tint}1F`, borderColor: "transparent" }}>
          <SymbolView name={info.icon} size={20} tintColor={info.tint} />
        </View>
        <Text className="coach__tl-time">{clock}</Text>
        <Text className="coach__tl-time">{meridiem}</Text>
        <View className="coach__tl-dot" />
        {!last && <View className="coach__tl-line" />}
      </View>
      <View className="min-w-0 flex-1" style={{ paddingBottom: last ? 0 : 16 }}>{children}</View>
    </View>
  );
}

// A logged meal: slot pill, calories, the dish, its foods, the macros and a "Logged" mark. The
// whole card opens the meal (no button inside a button).
function LoggedCard({ meal, onOpen }: { meal: Meal; onOpen: (meal: Meal) => void }) {
  const colors = useThemeColors();
  const info = slotInfo[meal.slot];
  const foods = meal.items.map((item) => item.name).join(", ");
  const macros: [string, number][] = [["P", meal.totals.proteinG], ["C", meal.totals.carbsG], ["F", meal.totals.fatG]];
  return (
    <Pressable onPress={() => onOpen(meal)} className="coach__meal-card" accessibilityRole="button" accessibilityLabel={`${info.label}: ${meal.title}, ${whole(meal.totals.kcal)} kcal at ${clockTime(meal.loggedAt)}`}>
      <View className="flex-row flex-wrap items-center justify-between" style={{ gap: 8 }}>
        <View className="coach__slot-pill">
          <Text className="coach__slot-pill-label">{info.label}</Text>
        </View>
        <View className="flex-row items-center" style={{ gap: 6 }}>
          <Text className="coach__meal-kcal">{`${whole(meal.totals.kcal)} kcal`}</Text>
          <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
        </View>
      </View>
      <Text className="coach__meal-name" numberOfLines={2}>{meal.title}</Text>
      {foods !== meal.title && <Text className="coach__meal-ings" numberOfLines={2}>{foods}</Text>}
      <View className="flex-row flex-wrap items-end justify-between" style={{ gap: 10 }}>
        <View className="flex-row flex-wrap" style={{ gap: 8, flexGrow: 1, flexShrink: 1 }} accessibilityLabel={`Protein ${whole(meal.totals.proteinG)} g, carbs ${whole(meal.totals.carbsG)} g, fat ${whole(meal.totals.fatG)} g`}>
          {macros.map(([k, v]) => (
            <View key={k} className="coach__macro-chip">
              <Text className="coach__macro-chip-label">{`${k} ${whole(v)} g`}</Text>
            </View>
          ))}
        </View>
        <View className="coach__log coach__log--meal coach__log--done">
          <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={12} tintColor={colors.leaf} />
          <Text className="coach__log-label coach__log-label--done">Logged</Text>
        </View>
      </View>
    </Pressable>
  );
}

// A slot with nothing in it: on today a card with a Log Meal button (the whole card is the
// button), on a past day a quiet note
function EmptyCard({ slot, onAdd }: { slot: Slot; onAdd?: (slot: Slot) => void }) {
  const info = slotInfo[slot];
  const body = (
    <>
      <View className="flex-row flex-wrap items-center justify-between" style={{ gap: 8 }}>
        <View className="coach__slot-pill">
          <Text className="coach__slot-pill-label">{info.label}</Text>
        </View>
        <Text className="coach__meal-kcal">0 kcal</Text>
      </View>
      <Text className="coach__meal-name">Not logged yet</Text>
      <View className="flex-row flex-wrap items-end justify-between" style={{ gap: 10 }}>
        <Text className="coach__meal-ings" style={{ flexShrink: 1 }}>{onAdd ? `Usually ${info.window}.` : "Nothing was logged in this slot."}</Text>
        {onAdd && (
          <View className="coach__log coach__log--meal">
            <Text className="coach__log-label">Log Meal</Text>
          </View>
        )}
      </View>
    </>
  );
  return onAdd ? (
    <Pressable onPress={() => onAdd(slot)} className="coach__meal-card" accessibilityRole="button" accessibilityLabel={`${info.label}: not logged yet. Add ${info.label.toLowerCase()}`}>
      {body}
    </Pressable>
  ) : (
    <View className="coach__meal-card" style={{ opacity: 0.7 }}>{body}</View>
  );
}

export function MealTimeline({ rows, onOpen, onAdd }: Props) {
  return (
    <View>
      {rows.map((row, i) => {
        const at = row.meal ? new Date(row.meal.loggedAt) : null;
        const time: [number, number] = at ? [at.getHours(), at.getMinutes()] : slotInfo[row.slot].defaultTime;
        return (
          <Entry key={row.meal?.id ?? row.slot} slot={row.slot} time={time} last={i === rows.length - 1}>
            {row.meal ? <LoggedCard meal={row.meal} onOpen={onOpen} /> : <EmptyCard slot={row.slot} onAdd={onAdd} />}
          </Entry>
        );
      })}
    </View>
  );
}
