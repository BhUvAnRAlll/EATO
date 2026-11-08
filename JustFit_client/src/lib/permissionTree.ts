// Role & Permission's tick rules (pure, unit-tested). The tree comes from the server
// (GET /api/gym/staff → permissionTree); an option's `needs` is the one it can't work without, so
// ticking it ticks that one too and unticking that one unticks it. The server applies the same
// rule when it saves.
import type { PermissionTile, StaffOption } from "@/lib/gymApi";

// The ticked options of a tile
export const tickedIn = (tile: PermissionTile, ticked: StaffOption[]) => tile.options.filter((o) => ticked.includes(o.id));

// Ticks or unticks one option, keeping what it needs (or what needs it) in step
export function toggleOption(tree: PermissionTile[], ticked: StaffOption[], id: StaffOption): StaffOption[] {
  const options = tree.flatMap((t) => t.options);
  const next = new Set(ticked);
  if (next.has(id)) {
    next.delete(id);
    options.filter((o) => o.needs === id).forEach((o) => next.delete(o.id));
  } else {
    next.add(id);
    const needs = options.find((o) => o.id === id)?.needs;
    if (needs) next.add(needs);
  }
  return options.map((o) => o.id).filter((o) => next.has(o));
}

// A tile's box: ticked while any of its options is; tapping it unticks them all, or ticks them all
export function toggleTile(tree: PermissionTile[], ticked: StaffOption[], tile: PermissionTile): StaffOption[] {
  const mine = tile.options.map((o) => o.id);
  const on = tickedIn(tile, ticked).length > 0;
  const next = new Set(ticked.filter((id) => !mine.includes(id)));
  if (!on) mine.forEach((id) => next.add(id));
  return tree.flatMap((t) => t.options.map((o) => o.id)).filter((id) => next.has(id));
}

// The search: a tile whose name matches shows all its options; otherwise only the options that
// match, and a tile with none is left out
export function filterTree(tree: PermissionTile[], query: string): PermissionTile[] {
  const q = query.trim().toLowerCase();
  if (!q) return tree;
  return tree
    .map((tile) => (tile.label.toLowerCase().includes(q) ? tile : { ...tile, options: tile.options.filter((o) => o.label.toLowerCase().includes(q)) }))
    .filter((tile) => tile.options.length > 0);
}

// Whether two lists hold the same options (the Save button waits for a change)
export const sameOptions = (a: StaffOption[], b: StaffOption[]) => a.length === b.length && a.every((id) => b.includes(id));

// A Staff login in one line: "All areas", "Home only" or "Members (2 of 5), Enquiries"
export function optionsLine(tree: PermissionTile[], ticked: StaffOption[]): string {
  const all = tree.flatMap((t) => t.options).length;
  if (ticked.length === 0) return "Home only";
  if (ticked.length >= all) return "All areas";
  return tree
    .map((tile) => {
      const on = tickedIn(tile, ticked).length;
      if (on === 0) return null;
      return on === tile.options.length ? tile.label : `${tile.label} (${on} of ${tile.options.length})`;
    })
    .filter(Boolean)
    .join(", ");
}
