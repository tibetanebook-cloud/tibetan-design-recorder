/**
 * Cursor / click / keystroke metadata track, written to cursor.jsonl as it
 * happens (flushed every second, so a crash loses at most ~1 s).
 *
 * Positions are sampled in the main process at 60 Hz and only stored when they
 * change (plus a 1 Hz keep-alive while resting). Clicks, wheel and keys come from
 * a global input hook (uiohook-napi). Times are on the take clock, coordinates
 * are normalized to the captured area (values outside 0..1 = cursor outside it).
 *
 * Keystrokes: by default only shortcuts (Ctrl/Alt/Cmd + key) and special keys
 * (Enter, Tab, arrows, F-keys…) are logged — never ordinary typed text, so
 * passwords and private text are not recorded. Typed text is an opt-in setting.
 * Presses of our own recording hotkeys are left out.
 */
import { screen } from "electron";
import { promises as fs } from "node:fs";
import type { Rect } from "@shared/project/schema";
import type { RecordingClock } from "@shared/recording/clock";
import { cursorHeaderLine, cursorLine, type CursorHeader } from "@shared/recording/cursorFile";
import type { InputEvent } from "@shared/recording/types";

export const CURSOR_SAMPLE_HZ = 60;
const KEEPALIVE_MS = 1000;
const FLUSH_MS = 1000;

type Hook = typeof import("uiohook-napi");
let hookModule: Hook | null | undefined;
function loadHook(): Hook | null {
  if (hookModule !== undefined) return hookModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    hookModule = require("uiohook-napi") as Hook;
  } catch (error) {
    console.warn("Global input hook unavailable; clicks/keys will not be recorded:", error);
    hookModule = null;
  }
  return hookModule;
}

/** True when the global click/keyboard hook (uiohook-napi) can be loaded on this OS. */
export const inputHookAvailable = (): boolean => loadHook() !== null;

const SPECIAL_KEYS = new Set([
  "Enter", "Tab", "Escape", "Backspace", "Delete", "Space", "Home", "End", "PageUp", "PageDown",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Insert",
  "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
]);
const MODIFIER_KEYS = new Set(["Ctrl", "Alt", "Shift", "Meta", "CtrlRight", "AltRight", "ShiftRight", "MetaRight"]);
/** Our global hotkeys: Ctrl/Cmd+Shift+F9/F10/F11/M. */
const isOwnHotkey = (key: string, mods: string[]) =>
  (mods.includes("Ctrl") || mods.includes("Meta")) && mods.includes("Shift") && ["F9", "F10", "F11", "M"].includes(key);

export class CursorRecorder {
  private buffer: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private keyNames: Record<number, string> = {};
  private hookStarted = false;
  private last: { t: number; x: number; y: number } | null = null;
  private readonly area: Rect;
  private writing: Promise<void> = Promise.resolve();
  counts = { samples: 0, events: 0 };

  constructor(
    private readonly path: string,
    private readonly clock: RecordingClock,
    private readonly displayBounds: Rect,
    private readonly region: Rect | undefined,
    private readonly recordTypedKeys: boolean,
  ) {
    // Always normalize to the whole display (screen-source space): a recorded region
    // is a crop of the full-display video, so cursor and crop map the same way.
    void region;
    this.area = displayBounds;
  }

  private norm(x: number, y: number): { x: number; y: number } {
    const r = (v: number) => Math.round(v * 10000) / 10000;
    return { x: r((x - this.area.x) / this.area.width), y: r((y - this.area.y) / this.area.height) };
  }

  private time(): number {
    return Math.round(this.clock.now() * 10) / 10;
  }

  async start(): Promise<void> {
    const header: CursorHeader = {
      format: "tdrec-cursor",
      version: 1,
      space: { width: this.area.width, height: this.area.height, displayBounds: this.displayBounds, region: this.region, coords: "display" },
      sampleHz: CURSOR_SAMPLE_HZ,
    };
    await fs.writeFile(this.path, cursorHeaderLine(header) + "\n");
    this.timer = setInterval(() => this.sample(), 1000 / CURSOR_SAMPLE_HZ);
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_MS);
    this.sample();
    this.startHook();
  }

  private startHook(): void {
    const hook = loadHook();
    if (!hook) return;
    const { uIOhook, UiohookKey } = hook;
    this.keyNames = Object.fromEntries(Object.entries(UiohookKey).map(([name, code]) => [code as number, name]));
    // uiohook reports physical pixels on Windows; convert to DIP like the sampler.
    const at = (x: number, y: number) => {
      const p = process.platform === "win32" ? screen.screenToDipPoint({ x, y }) : { x, y };
      return this.norm(p.x, p.y);
    };
    uIOhook.on("mousedown", (e) => this.event({ t: 0, type: "down", button: Number(e.button), clicks: e.clicks, ...at(e.x, e.y) }));
    uIOhook.on("mouseup", (e) => this.event({ t: 0, type: "up", button: Number(e.button), clicks: e.clicks, ...at(e.x, e.y) }));
    uIOhook.on("wheel", (e) =>
      this.event({ t: 0, type: "wheel", dx: e.direction === 4 ? e.rotation : 0, dy: e.direction === 3 ? e.rotation : 0, ...at(e.x, e.y) }),
    );
    uIOhook.on("keydown", (e) => {
      const key = this.keyNames[e.keycode] ?? `Key${e.keycode}`;
      if (MODIFIER_KEYS.has(key)) return;
      const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Meta"].filter(Boolean) as string[];
      if (isOwnHotkey(key, mods)) return;
      const isShortcut = mods.some((m) => m !== "Shift");
      if (!this.recordTypedKeys && !isShortcut && !SPECIAL_KEYS.has(key)) return;
      this.event({ t: 0, type: "key", key, mods });
    });
    uIOhook.start();
    this.hookStarted = true;
  }

  private event(e: InputEvent): void {
    if (this.clock.paused) return;
    this.buffer.push(cursorLine({ ...e, t: this.time() }));
    this.counts.events++;
  }

  private sample(): void {
    if (this.clock.paused) return;
    const p = screen.getCursorScreenPoint();
    const { x, y } = this.norm(p.x, p.y);
    const t = this.time();
    const moved = !this.last || this.last.x !== x || this.last.y !== y;
    if (!moved && t - this.last!.t < KEEPALIVE_MS) return;
    this.last = { t, x, y };
    this.buffer.push(cursorLine([t, x, y]));
    this.counts.samples++;
  }

  private flush(): Promise<void> {
    if (!this.buffer.length) return this.writing;
    const text = this.buffer.join("\n") + "\n";
    this.buffer = [];
    this.writing = this.writing.then(() => fs.appendFile(this.path, text));
    return this.writing;
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.timer = this.flushTimer = null;
    this.sample();
    if (this.hookStarted) {
      const hook = loadHook();
      hook?.uIOhook.removeAllListeners();
      hook?.uIOhook.stop();
      this.hookStarted = false;
    }
    await this.flush();
  }
}
