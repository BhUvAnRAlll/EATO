import { create } from "zustand";

import { hudText, type HudKind } from "@/lib/hudRules";

export type HudMessage = { id: number; kind: HudKind; text: string };

type HudState = {
  // The message on screen now (one at a time: a newer one replaces it)
  current: HudMessage | null;
  // Mounted HudHosts, oldest first; the last one draws (lib/hudRules.ts topHost)
  hosts: number[];
  show: (kind: HudKind, text: string) => void;
  hide: (id: number) => void;
  addHost: (id: number) => void;
  removeHost: (id: number) => void;
};

let nextId = 1;

export const useHudStore = create<HudState>((set) => ({
  current: null,
  hosts: [],
  show: (kind, text) => set({ current: { id: nextId++, kind, text: hudText(text) } }),
  hide: (id) => set((state) => (state.current?.id === id ? { current: null } : state)),
  addHost: (id) => set((state) => ({ hosts: [...state.hosts, id] })),
  removeHost: (id) => set((state) => ({ hosts: state.hosts.filter((h) => h !== id) })),
}));
