/**
 * Editor keyboard shortcuts: every action has a default that the user can rebind
 * (Edit ▸ Keyboard Shortcuts). "Mod" means Ctrl on Windows/Linux and Cmd on macOS.
 * Only known actions from a saved file are applied on top of the defaults.
 */
export interface ShortcutAction {
  id: string;
  /** i18n key for the action's name. */
  label: string;
  defaultKey: string | null;
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: "transport.playPause", label: "shortcuts.playPause", defaultKey: "Space" },
  { id: "transport.back", label: "timeline.back", defaultKey: "J" },
  { id: "transport.pause", label: "timeline.pause", defaultKey: "K" },
  { id: "transport.play", label: "timeline.play", defaultKey: "L" },
  { id: "transport.prevFrame", label: "timeline.prevFrame", defaultKey: "ArrowLeft" },
  { id: "transport.nextFrame", label: "timeline.nextFrame", defaultKey: "ArrowRight" },
  { id: "transport.start", label: "timeline.goStart", defaultKey: "Home" },
  { id: "transport.end", label: "timeline.goEnd", defaultKey: "End" },
  { id: "edit.split", label: "edit.split", defaultKey: "S" },
  { id: "edit.delete", label: "edit.delete", defaultKey: "Delete" },
  { id: "edit.rippleDelete", label: "edit.rippleDelete", defaultKey: "Shift+Delete" },
  { id: "edit.duplicate", label: "edit.duplicate", defaultKey: "Mod+D" },
  { id: "edit.copy", label: "edit.copy", defaultKey: "Mod+C" },
  { id: "edit.cut", label: "edit.cut", defaultKey: "Mod+X" },
  { id: "edit.paste", label: "edit.paste", defaultKey: "Mod+V" },
  { id: "edit.selectAll", label: "edit.selectAll", defaultKey: "Mod+A" },
  { id: "edit.link", label: "edit.link", defaultKey: "Mod+L" },
  { id: "edit.unlink", label: "edit.unlink", defaultKey: "Mod+Shift+L" },
  { id: "edit.undo", label: "edit.undo", defaultKey: "Mod+Z" },
  { id: "edit.redo", label: "edit.redo", defaultKey: "Mod+Shift+Z" },
  { id: "insert.marker", label: "insert.marker", defaultKey: "M" },
  { id: "insert.chapter", label: "insert.chapter", defaultKey: "Shift+M" },
  { id: "view.zoomIn", label: "view.zoomIn", defaultKey: "=" },
  { id: "view.zoomOut", label: "view.zoomOut", defaultKey: "-" },
  { id: "view.fitTimeline", label: "view.fitTimeline", defaultKey: "Shift+Z" },
  { id: "view.snapping", label: "view.snapping", defaultKey: "N" },
  { id: "effects.zoomRegion", label: "effects.zoomRegion", defaultKey: "Z" },
  { id: "effects.autoZoom", label: "effects.autoZoom", defaultKey: "Shift+A" },
  { id: "range.in", label: "range.in", defaultKey: "I" },
  { id: "range.out", label: "range.out", defaultKey: "O" },
  { id: "range.clear", label: "range.clear", defaultKey: "Shift+X" },
  { id: "effects.speedUp", label: "effects.speedUp", defaultKey: "]" },
  { id: "effects.slowDown", label: "effects.slowDown", defaultKey: "[" },
  { id: "file.newProject", label: "file.newProject", defaultKey: "Mod+N" },
  { id: "file.open", label: "file.open", defaultKey: "Mod+O" },
  { id: "file.save", label: "file.save", defaultKey: "Mod+S" },
  { id: "file.saveAs", label: "file.saveAs", defaultKey: "Mod+Shift+S" },
  { id: "file.import", label: "file.import", defaultKey: "Mod+I" },
  { id: "export.video", label: "export.video", defaultKey: "Mod+E" },
];

export type ShortcutMap = Record<string, string | null>;

export function defaultShortcuts(): ShortcutMap {
  return Object.fromEntries(SHORTCUT_ACTIONS.map((a) => [a.id, a.defaultKey]));
}

/** Saved overrides on top of the defaults; unknown actions and bad values are ignored. */
export function resolveShortcuts(saved: unknown): ShortcutMap {
  const map = defaultShortcuts();
  if (saved && typeof saved === "object")
    for (const [id, key] of Object.entries(saved as Record<string, unknown>))
      if (id in map && (key === null || (typeof key === "string" && key.length < 40))) map[id] = key;
  return map;
}

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "OS"]);

/** KeyboardEvent -> "Mod+Shift+S" (null while only a modifier is held). */
/** The parts of a keyboard event we need (works without the DOM types). */
export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function eventToShortcut(e: KeyLike, isMac: boolean): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  // Use the physical key for letters/digits so Tibetan keyboard layouts still work.
  let key = e.key;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (e.code === "Space") key = "Space";
  else if (e.code === "Equal") key = "=";
  else if (e.code === "Minus") key = "-";
  else if (key.length === 1) key = key.toUpperCase();
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push("Mod");
  if (isMac && e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

/** "Mod+Shift+S" -> "Ctrl+Shift+S" / "⌘⇧S" for display. */
export function displayShortcut(key: string | null, isMac: boolean): string {
  if (!key) return "";
  if (!isMac) return key.replace("Mod", "Ctrl").replace("ArrowLeft", "←").replace("ArrowRight", "→");
  return key
    .replace("Mod+", "⌘")
    .replace("Ctrl+", "⌃")
    .replace("Alt+", "⌥")
    .replace("Shift+", "⇧")
    .replace("ArrowLeft", "←")
    .replace("ArrowRight", "→");
}

/** Actions that share a key with `id` (for the conflict warning). */
export function conflicts(map: ShortcutMap, id: string): string[] {
  const key = map[id];
  if (!key) return [];
  return Object.entries(map)
    .filter(([other, k]) => other !== id && k === key)
    .map(([other]) => other);
}
