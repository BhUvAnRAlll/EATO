import { useCallback, useEffect, useRef, type ComponentRef } from "react";
import type { LayoutChangeEvent, ScrollView } from "react-native";

type Box = { x: number; width: number };

// A row of filter chips that scrolls sideways keeps the selected chip in view, whole and lined up
// with the gutter (see center below), so the filter that is on is never off-screen (the user's
// screenshots, 2026-11-07 and 2026-11-08). Each chip reports its x and width as it lays out, the
// row its width, and the row scrolls once both are known: when the screen opens on a chip past
// the edge, when counts arriving re-lay the chips, and (animated) when another chip is picked.
// The ScrollView clamps the ends itself, so the first and last chips stay flush.
//
//   const { setRow, onRowLayout, onChipLayout } = useCenteredChip(filter);
//   <ScrollView ref={setRow} onLayout={onRowLayout} horizontal>
//     <Chip onLayout={onChipLayout(id)} />
//
// Destructure the answer: the lint takes whatever is passed to ref= as a ref, so chips.setRow
// would make every chips.… read look like reading a ref during render.
export function useCenteredChip<K extends string | number>(selected: K) {
  const row = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const boxes = useRef(new Map<K, Box>());
  const rowWidth = useRef(0);
  const current = useRef(selected);

  // Since the 2026-11-08 review the row lines a whole chip up with the left gutter instead of
  // centring: centring left a cut piece of a chip at the left edge ("verdue · 0"). The row stays
  // at its start when the selected chip already fits there; otherwise the chip before it starts
  // at the gutter (so the selected one keeps a neighbour), or the selected one itself when the
  // two don't fit together. Only the right edge can show a cut chip, which reads as "more".
  const center = useCallback((animated: boolean) => {
    const chip = boxes.current.get(current.current);
    const width = rowWidth.current;
    if (!chip || !width || !row.current) return;
    const all = [...boxes.current.values()].sort((a, b) => a.x - b.x);
    const gutter = all[0]?.x ?? 0;
    let x = 0;
    if (chip.x + chip.width + gutter > width) {
      const before = all.filter((b) => b.x < chip.x).pop();
      x = before && chip.x + chip.width - before.x + gutter * 2 <= width ? before.x - gutter : chip.x - gutter;
    }
    row.current.scrollTo({ x: Math.max(0, x), animated });
  }, []);

  // A tap on a chip half under the edge brings it into the middle
  useEffect(() => {
    current.current = selected;
    center(true);
  }, [selected, center]);

  // Only functions go back (a callback ref, not the ref itself), so screens read nothing during render
  const setRow = useCallback((node: ComponentRef<typeof ScrollView> | null) => {
    row.current = node;
  }, []);
  const onRowLayout = useCallback((e: LayoutChangeEvent) => {
    rowWidth.current = e.nativeEvent.layout.width;
    center(false);
  }, [center]);
  const onChipLayout = useCallback((id: K) => (e: LayoutChangeEvent) => {
    boxes.current.set(id, { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width });
    if (id === current.current) center(false);
  }, [center]);

  return { setRow, onRowLayout, onChipLayout };
}
