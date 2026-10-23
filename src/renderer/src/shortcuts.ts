/** Current editor shortcuts (defaults + the user's saved overrides). */
import { create } from "zustand";
import { defaultShortcuts, resolveShortcuts, type ShortcutMap } from "@shared/shortcuts";

interface ShortcutStore {
  map: ShortcutMap;
  load: (saved: unknown) => void;
  setKey: (id: string, key: string | null) => void;
  reset: (id: string) => void;
  resetAll: () => void;
}

/** Only differences from the defaults are saved. */
function persist(map: ShortcutMap): void {
  const defaults = defaultShortcuts();
  const overrides = Object.fromEntries(Object.entries(map).filter(([id, key]) => defaults[id] !== key));
  void window.tdr.setShortcuts(overrides);
}

export const useShortcuts = create<ShortcutStore>((set, get) => ({
  map: defaultShortcuts(),
  load: (saved) => set({ map: resolveShortcuts(saved) }),
  setKey: (id, key) => {
    const map = { ...get().map, [id]: key };
    set({ map });
    persist(map);
  },
  reset: (id) => get().setKey(id, defaultShortcuts()[id] ?? null),
  resetAll: () => {
    const map = defaultShortcuts();
    set({ map });
    persist(map);
  },
}));
