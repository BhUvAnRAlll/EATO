// The HUD's rules, kept free of React Native so they can be unit-tested (lib/hud.ts shows it).

export type HudKind = "success" | "error" | "offline";

// How long each kind stays up: a success is a glance, a problem gets time to be read
export const HUD_MS: Record<HudKind, number> = { success: 1600, error: 3200, offline: 3200 };

export const OFFLINE_TEXT = "No connection. Try again.";

// HUD lines stay short: anything longer is cut at a word with an ellipsis (the full story belongs
// in the screen's own error line, not in a message that disappears)
export const HUD_MAX_CHARS = 60;

export function hudText(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= HUD_MAX_CHARS) return line;
  const cut = line.slice(0, HUD_MAX_CHARS - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > HUD_MAX_CHARS / 2 ? cut.slice(0, space) : cut).replace(/[\s.,;:]+$/, "")}…`;
}

// Only the newest host draws the HUD: the app's root, or the sheet open over it (a Modal is its own
// window, so a HUD drawn at the root would sit under the sheet)
export function topHost(hosts: readonly number[]): number | null {
  return hosts.length > 0 ? hosts[hosts.length - 1] : null;
}
