import { useEffect, useState } from "react";
import { Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import { router, type Href } from "expo-router";
import { GestureDetector, GestureHandlerRootView, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { PressableScale } from "@/components/PressableScale";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { GymIcon } from "@/components/gym/GymIcon";
import type { GymIconName } from "@/constants/gymIcons";
import { gymApi, type StaffOption } from "@/lib/gymApi";
import { haptic } from "@/lib/haptics";
import { hud } from "@/lib/hud";
import { useSessionToken } from "@/lib/session";
import { inSavedOrder, moveTile, sameOrder, slotAfterDrag } from "@/lib/tileOrder";
import { useThemeColors } from "@/theme";

export type TodayTile = { id: string; value: number; label: string; color: { box: string; icon: string }; icon: GymIconName; href: Href; need: StaffOption };

type Props = {
  tiles: TodayTile[];
  // The order this login saved (GET /api/gym/dashboard tileOrder), or null for the usual one
  savedOrder: string[] | null;
  columns: number;
  can: (option: StaffOption) => boolean;
  // Home stops scrolling while the tiles are being arranged, so a drag moves a tile, not the page
  onEditingChange?: (editing: boolean) => void;
};

// Home › Today, with jiggle mode (step 6 of the native interactions plan, 2026-11-09): hold a
// tile to arrange them. The tiles wobble (still with Reduce Motion), a drag drops one where the
// finger lets go, and Done saves this login's order at this branch (PUT /api/gym/home-tiles).
// Screen readers get Move earlier / Move later on each tile instead of the drag.
export function TodayTiles({ tiles, savedOrder, columns, can, onEditingChange }: Props) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [editing, setEditing] = useState(false);
  // The order on screen once it has been arranged here (null: the saved one)
  const [order, setOrder] = useState<string[] | null>(null);
  const [grid, setGrid] = useState({ width: 0, height: 0 });
  const shown = inSavedOrder(tiles, order ?? savedOrder);
  const rows = Math.ceil(shown.length / columns);
  const cell = { width: grid.width / columns, height: rows ? grid.height / rows : 0, columns, count: shown.length };

  const setMode = (next: boolean) => {
    setEditing(next);
    onEditingChange?.(next);
  };
  const start = () => {
    if (editing) return;
    haptic.select();
    setMode(true);
  };
  const move = (from: number, to: number) => {
    const next = moveTile(shown.map((t) => t.id), from, to);
    if (sameOrder(next, shown.map((t) => t.id))) return;
    haptic.select();
    setOrder(next);
  };
  const done = async () => {
    setMode(false);
    const now = shown.map((t) => t.id);
    if (sameOrder(now, inSavedOrder(tiles, savedOrder).map((t) => t.id))) return;
    const result = await gymApi.saveHomeTiles(await getToken().catch(() => null), now);
    if (result.ok) hud.success("Tiles arranged");
    else hud.error(result.status === 503 ? "Arranging isn't on this server yet" : "Couldn't save the order");
  };

  return (
    <>
      <View className="flex-row items-center">
        <Text className="gym-dash-section__title" accessibilityRole="header">Today</Text>
        {editing ? (
          <>
            <Text className="gym-dash-section__note flex-1">Drag a tile to move it</Text>
            <Pressable onPress={() => void done()} hitSlop={10} className="gym-tiles__done" accessibilityRole="button" accessibilityLabel="Done arranging">
              <Text className="gym-tiles__done-label">Done</Text>
            </Pressable>
          </>
        ) : (
          <Text className="gym-dash-section__note">{can("payments.transactions") ? "Tap a count, hold to arrange" : "Today's counts · hold to arrange"}</Text>
        )}
      </View>
      {/* The page's root has no gesture root of its own (the app's root has none) */}
      <GestureHandlerRootView>
        <View className="gym-dash-card flex-row flex-wrap" onLayout={(e: LayoutChangeEvent) => setGrid({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
          {shown.map((tile, index) => (
            <Tile
              key={tile.id}
              tile={tile}
              index={index}
              columns={columns}
              editing={editing}
              open={can(tile.need)}
              onHold={start}
              onDrop={(dx, dy) => move(index, slotAfterDrag(index, dx, dy, cell))}
              onStep={(by) => move(index, index + by)}
              borderColor={colors.gymHairline}
              last={index === shown.length - 1}
            />
          ))}
        </View>
      </GestureHandlerRootView>
    </>
  );
}

type TileProps = {
  tile: TodayTile;
  index: number;
  columns: number;
  editing: boolean;
  open: boolean;
  last: boolean;
  borderColor: string;
  onHold: () => void;
  onDrop: (dx: number, dy: number) => void;
  onStep: (by: number) => void;
};

function Tile({ tile, index, columns, editing, open, last, borderColor, onHold, onDrop, onStep }: TileProps) {
  const reduceMotion = useReducedMotion();
  const tilt = useSharedValue(0);
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const lifted = useSharedValue(0);

  // The wobble: alternate tiles lean opposite ways first, so the grid doesn't sway as one
  useEffect(() => {
    if (!editing || reduceMotion) {
      tilt.set(withTiming(0, { duration: 120 }));
      return;
    }
    const lean = index % 2 === 0 ? 1.4 : -1.4;
    tilt.set(withDelay((index % 3) * 60, withRepeat(withSequence(withTiming(lean, { duration: 120 }), withTiming(-lean, { duration: 120 })), -1, true)));
  }, [editing, reduceMotion, index, tilt]);

  const pan = usePanGesture({
    enabled: editing,
    runOnJS: true,
    minDistance: 4,
    onActivate: () => {
      lifted.set(withSpring(1, { damping: 18, stiffness: 300, reduceMotion: ReduceMotion.System }));
      haptic.select();
    },
    onUpdate: (e) => {
      dx.set(e.translationX);
      dy.set(e.translationY);
    },
    onDeactivate: (e) => {
      onDrop(e.translationX, e.translationY);
      dx.set(0);
      dy.set(0);
      lifted.set(withTiming(0, { duration: 150, reduceMotion: ReduceMotion.System }));
    },
  });

  const style = useAnimatedStyle(() => ({
    zIndex: lifted.get() > 0 ? 10 : 0,
    elevation: lifted.get() > 0 ? 6 : 0,
    transform: [{ translateX: dx.get() }, { translateY: dy.get() }, { scale: 1 + lifted.get() * 0.06 }, { rotate: `${tilt.get()}deg` }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        layout={LinearTransition.duration(180).reduceMotion(ReduceMotion.System)}
        style={[{ width: `${100 / columns}%` }, style]}
      >
        <PressableScale
          onPress={!editing && open ? () => router.push(tile.href) : undefined}
          onLongPress={editing ? undefined : onHold}
          delayLongPress={400}
          className="gym-dash-stat"
          style={{ borderColor, borderRightWidth: editing || index % columns === columns - 1 || last ? 0 : 1, borderTopWidth: !editing && index >= columns ? 1 : 0 }}
          accessibilityRole={open && !editing ? "button" : "text"}
          accessibilityLabel={`${tile.value} ${tile.label}`}
          accessibilityHint={editing ? "Use the actions to move it" : "Hold to arrange the tiles"}
          accessibilityActions={editing ? [{ name: "earlier", label: "Move earlier" }, { name: "later", label: "Move later" }] : [{ name: "longpress", label: "Arrange the tiles" }]}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === "earlier") onStep(-1);
            else if (e.nativeEvent.actionName === "later") onStep(1);
            else onHold();
          }}
        >
          <View className="gym-dash-stat__icon" style={{ backgroundColor: tile.color.box }}>
            <GymIcon name={tile.icon} size={16} color={tile.color.icon} />
          </View>
          <View>
            <AnimatedNumber className="gym-dash-stat__value">{String(tile.value)}</AnimatedNumber>
            <Text className="gym-dash-stat__label" numberOfLines={1}>{tile.label}</Text>
          </View>
        </PressableScale>
      </Animated.View>
    </GestureDetector>
  );
}
