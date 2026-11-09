import { useRef, type ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";

import { GymIcon } from "@/components/gym/GymIcon";
import type { GymIconName } from "@/constants/gymIcons";
import { haptic } from "@/lib/haptics";

export type SwipeAction = { key: string; label: string; icon: GymIconName; color: string; ground: string; onPress: () => void };

// Only one row open at a time: opening another closes the last
let openRow: SwipeableMethods | null = null;

// Android asks for a firmer drag before a panel snaps open (Material's lists), iPhone a lighter one
const THRESHOLD = Platform.OS === "android" ? 72 : 48;

// Swipe actions on a card (2026-11-09, step 3 of the native interactions plan): drag the card left
// for `right` (Call, Message) and right for `left` (Edit, More). The panel snaps open past the
// threshold with a selection tick; tapping an action closes the row, taps and runs it. Android's
// buttons ripple. Everything here is also on the card's ⋯ sheet, so a screen reader or anyone who
// doesn't swipe loses nothing. Inside a GestureHandlerRootView (MemberList has its own).
export function SwipeActions({ left = [], right = [], enabled = true, children }: { left?: SwipeAction[]; right?: SwipeAction[]; enabled?: boolean; children: ReactNode }) {
  const row = useRef<SwipeableMethods>(null);
  if (!enabled || (left.length === 0 && right.length === 0)) return <>{children}</>;

  return (
    <View className="gym-swipe">
      <ReanimatedSwipeable
        ref={row}
        friction={1.4}
        leftThreshold={THRESHOLD}
        rightThreshold={THRESHOLD}
        overshootLeft={false}
        overshootRight={false}
        containerStyle={{ borderRadius: 20 }}
        renderLeftActions={left.length > 0 ? (_p, _t, methods) => <ActionPanel actions={left} methods={methods} /> : undefined}
        renderRightActions={right.length > 0 ? (_p, _t, methods) => <ActionPanel actions={right} methods={methods} /> : undefined}
        onSwipeableWillOpen={() => {
          if (openRow && openRow !== row.current) openRow.close();
          openRow = row.current;
          haptic.select();
        }}
        onSwipeableClose={() => {
          if (openRow === row.current) openRow = null;
        }}
      >
        {children}
      </ReanimatedSwipeable>
    </View>
  );
}

// The buttons behind the card: tapping one closes the row, taps and runs it (Android ripples)
function ActionPanel({ actions, methods }: { actions: SwipeAction[]; methods: SwipeableMethods }) {
  return (
    <View className="gym-swipe__panel">
      {actions.map((action) => (
        <Pressable
          key={action.key}
          onPress={() => {
            methods.close();
            haptic.tap();
            action.onPress();
          }}
          android_ripple={{ color: `${action.color}33` }}
          className="gym-swipe__action"
          style={{ backgroundColor: action.ground }}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <GymIcon name={action.icon} size={20} color={action.color} />
          <Text className="gym-swipe__label" style={{ color: action.color }} numberOfLines={1}>{action.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
