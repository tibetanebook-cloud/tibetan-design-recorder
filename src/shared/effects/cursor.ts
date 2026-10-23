/**
 * Cursor rendering state from the metadata track, as a pure function of time.
 * Coordinates here are screen-source space: 0–1 across the whole captured display.
 */
import type { CursorStyle } from "../project/schema";
import type { CursorTrack, InputEvent } from "../recording/types";
import { easeOutQuint } from "./easing";
import { cursorSpring, spring2At } from "./spring";

export interface Pt {
  x: number;
  y: number;
}

/**
 * Convert a track to display-normalized coordinates. Takes recorded before
 * Stage 4 normalized to the recorded region instead.
 */
export function toDisplaySpace(track: CursorTrack): CursorTrack {
  const { region, displayBounds, coords } = track.space;
  if (coords === "display" || !region) return track;
  const map = (x: number, y: number): [number, number] => [
    (region.x + x * region.width) / displayBounds.width,
    (region.y + y * region.height) / displayBounds.height,
  ];
  return {
    ...track,
    space: { ...track.space, coords: "display" },
    samples: track.samples.map(([t, x, y]) => [t, ...map(x, y)] as [number, number, number]),
    events: track.events.map((e): InputEvent => {
      if (!("x" in e)) return e;
      const [x, y] = map(e.x, e.y);
      return { ...e, x, y };
    }),
  };
}

/** Linear interpolation between the samples around `t` (binary search). */
export function positionAt(track: CursorTrack, t: number): Pt | null {
  const s = track.samples;
  if (!s.length) return null;
  if (t <= s[0]![0]) return { x: s[0]![1], y: s[0]![2] };
  const last = s[s.length - 1]!;
  if (t >= last[0]) return { x: last[1], y: last[2] };
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid]![0] <= t) lo = mid;
    else hi = mid;
  }
  const a = s[lo]!, b = s[hi]!;
  const k = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
  return { x: a[1] + (b[1] - a[1]) * k, y: a[2] + (b[2] - a[2]) * k };
}

export const clicksOf = (track: CursorTrack) =>
  track.events.filter((e): e is Extract<InputEvent, { button: number }> => e.type === "down");

/** Loop mode: compress real movement, then ease back to the first position in the last 670 ms. */
const LOOP_TAIL_MS = 670;
const LOOP_HOLD_MS = 120;

function loopedPosition(track: CursorTrack, t: number, startMs: number, endMs: number): Pt | null {
  const range = endMs - startMs;
  const tail = Math.min(LOOP_TAIL_MS, range);
  const active = range - tail;
  const local = t - startMs;
  if (local <= active) return positionAt(track, startMs + (local / Math.max(1, active)) * range);
  const from = positionAt(track, endMs);
  const to = positionAt(track, startMs);
  if (!from || !to) return from ?? to;
  const p = Math.min(1, (local - active) / Math.max(1, tail - LOOP_HOLD_MS));
  const k = easeOutQuint(p);
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
}

export interface ClickEffect {
  x: number;
  y: number;
  /** Remaining fraction of the effect, 1 -> 0. */
  remaining: number;
}

export interface KeyChip {
  label: string;
  opacity: number;
}

export interface CursorState {
  /** Smoothed position (source space). */
  pos: Pt;
  /** Velocity in source units per second (for blur and sway). */
  velocity: Pt;
  /** Click-bounce scale (≤ 1). */
  scale: number;
  /** Lean, radians. */
  rotation: number;
  clicks: ClickEffect[];
  keys: KeyChip[];
}

const KEY_SHOW_MS = 1500;
const KEY_FADE_MS = 800;

/**
 * Everything the renderer needs to draw the cursor at track time `t`.
 * `range` is the cursor clip's span in track time (for loop mode).
 */
export function cursorStateAt(track: CursorTrack, t: number, style: CursorStyle, range: { startMs: number; endMs: number }, stage: { width: number }): CursorState | null {
  const raw = (time: number) =>
    (style.loop ? loopedPosition(track, time, range.startMs, range.endMs) : positionAt(track, time)) ?? { x: 0.5, y: 0.5 };
  if (!track.samples.length) return null;
  const params = cursorSpring(style.smoothing);
  const at = (time: number) => (params ? spring2At(raw, time, params, 1000) : raw(time));
  const pos = at(t);
  const prev = at(t - 16);
  const velocity = { x: (pos.x - prev.x) * (1000 / 16), y: (pos.y - prev.y) * (1000 / 16) };

  // Click bounce: brief squash after each press.
  const clicks = clicksOf(track);
  let scale = 1;
  const lastClick = [...clicks].reverse().find((c) => c.t <= t && t - c.t < style.bounceMs);
  if (lastClick && style.clickBounce > 0) {
    const p = (t - lastClick.t) / style.bounceMs;
    scale = Math.max(0.72, 1 - Math.sin(Math.PI * p) * 0.08 * style.clickBounce);
  }

  // Sway: lean into the direction of travel, stronger when faster (capped at 1400 px/s).
  const speedPx = Math.hypot(velocity.x, velocity.y) * stage.width;
  const len = Math.hypot(velocity.x, velocity.y) || 1;
  const dir = (velocity.x + 0.65 * velocity.y) / len;
  const rotation = ((dir * Math.min(speedPx / 1400, 1) * 10 * style.sway * 3) * Math.PI) / 180;

  const effects: ClickEffect[] =
    style.clickEffect === "none"
      ? []
      : clicks
          .filter((c) => c.t <= t && t - c.t < style.clickEffectMs)
          .map((c) => ({ x: c.x, y: c.y, remaining: 1 - (t - c.t) / style.clickEffectMs }));

  const keys: KeyChip[] = style.keystrokes
    ? track.events
        .filter((e): e is Extract<InputEvent, { key: string }> => e.type === "key" && e.t <= t && t - e.t < KEY_SHOW_MS)
        .slice(-3)
        .map((e) => {
          const age = t - e.t;
          return { label: [...e.mods, e.key].join(" + "), opacity: age < KEY_SHOW_MS - KEY_FADE_MS ? 1 : (KEY_SHOW_MS - age) / KEY_FADE_MS };
        })
    : [];

  return { pos, velocity, scale, rotation, clicks: effects, keys };
}
