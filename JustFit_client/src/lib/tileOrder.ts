// Home's Today tiles in jiggle mode (2026-11-09): pure helpers for putting them in a saved order and
// for moving one, so the screen and the tests share them. Ids the saved order doesn't know go on the
// end in their usual place; ids it names that no longer exist are dropped.

export function inSavedOrder<T extends { id: string }>(tiles: T[], saved: string[] | null | undefined): T[] {
  if (!saved?.length) return tiles;
  const rank = new Map(saved.map((id, index) => [id, index]));
  return tiles
    .map((tile, index) => ({ tile, at: rank.get(tile.id) ?? saved.length + index }))
    .sort((a, b) => a.at - b.at)
    .map(({ tile }) => tile);
}

// The order with the tile at `from` moved to `to` (both clamped into the list)
export function moveTile<T>(list: T[], from: number, to: number): T[] {
  const last = list.length - 1;
  const a = Math.max(0, Math.min(last, from));
  const b = Math.max(0, Math.min(last, to));
  if (a === b) return list;
  const next = [...list];
  const [moved] = next.splice(a, 1);
  next.splice(b, 0, moved);
  return next;
}

// Which slot of a grid a finger is over: the tile's own slot plus how far it was dragged, in whole
// cells (rounded), kept inside the grid
export function slotAfterDrag(index: number, dx: number, dy: number, cell: { width: number; height: number; columns: number; count: number }): number {
  if (cell.width <= 0 || cell.height <= 0) return index;
  const column = (index % cell.columns) + Math.round(dx / cell.width);
  const row = Math.floor(index / cell.columns) + Math.round(dy / cell.height);
  const rows = Math.ceil(cell.count / cell.columns);
  const slot = Math.max(0, Math.min(rows - 1, row)) * cell.columns + Math.max(0, Math.min(cell.columns - 1, column));
  return Math.min(cell.count - 1, slot);
}

export const sameOrder = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
