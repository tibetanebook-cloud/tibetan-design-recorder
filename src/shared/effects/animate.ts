/**
 * Moving a clip over time: keyframes (position, size, rotation, opacity at chosen
 * moments) and behaviours (ready-made in / during / out motion). Pure functions of the
 * clip and its local time, so the preview and the export always agree.
 */
import type { Clip } from "../project/schema";

export interface ClipMotion {
  /** Offset from the clip's frame, in canvas pixels. */
  dx: number;
  dy: number;
  scale: number;
  /** Degrees, clockwise. */
  rotation: number;
  opacity: number;
}

export const NO_MOTION: ClipMotion = { dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1 };

const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
const easeOut = (k: number) => 1 - (1 - k) ** 3;
const easeIn = (k: number) => k ** 3;
const clamp01 = (k: number) => Math.max(0, Math.min(1, k));

type KeyframeLike = NonNullable<Clip["keyframes"]>[number];
const EASE: Record<KeyframeLike["ease"], (k: number) => number> = { linear: (k) => k, smooth: easeInOut, out: easeOut, in: easeIn };

function keyframesAt(keyframes: Clip["keyframes"], localMs: number): ClipMotion {
  if (!keyframes?.length) return NO_MOTION;
  const sorted = [...keyframes].sort((a, b) => a.t - b.t);
  const first = sorted[0]!;
  if (localMs <= first.t) return { dx: first.x, dy: first.y, scale: first.scale, rotation: first.rotation, opacity: first.opacity };
  for (let i = 1; i < sorted.length; i++) {
    const b = sorted[i]!;
    if (localMs > b.t) continue;
    const a = sorted[i - 1]!;
    const k = EASE[b.ease](clamp01((localMs - a.t) / Math.max(1, b.t - a.t)));
    const mix = (u: number, v: number) => u + (v - u) * k;
    return { dx: mix(a.x, b.x), dy: mix(a.y, b.y), scale: mix(a.scale, b.scale), rotation: mix(a.rotation, b.rotation), opacity: mix(a.opacity, b.opacity) };
  }
  const last = sorted[sorted.length - 1]!;
  return { dx: last.x, dy: last.y, scale: last.scale, rotation: last.rotation, opacity: last.opacity };
}

export const BEHAVIOR_IN_OUT = ["none", "fade", "fly-left", "fly-right", "fly-up", "fly-down", "pop", "spin", "drop"] as const;
export const BEHAVIOR_DURING = ["none", "pulse", "float", "shake", "sway", "spin"] as const;

/** Motion at progress k: k = 0 is fully away, k = 1 is at rest. */
function entrance(kind: string, k: number, size: { width: number; height: number }): ClipMotion {
  const away = 1 - k;
  switch (kind) {
    case "fade":
      return { ...NO_MOTION, opacity: k };
    case "fly-left":
      return { ...NO_MOTION, dx: -away * size.width, opacity: k };
    case "fly-right":
      return { ...NO_MOTION, dx: away * size.width, opacity: k };
    case "fly-up":
      return { ...NO_MOTION, dy: -away * size.height, opacity: k };
    case "fly-down":
      return { ...NO_MOTION, dy: away * size.height, opacity: k };
    case "pop":
      return { ...NO_MOTION, scale: 0.4 + 0.6 * k + Math.sin(k * Math.PI) * 0.14, opacity: clamp01(k * 2) };
    case "spin":
      return { ...NO_MOTION, rotation: -away * 180, scale: 0.5 + 0.5 * k, opacity: k };
    case "drop":
      // A small bounce as it lands.
      return { ...NO_MOTION, dy: -away * size.height * 0.5 + Math.abs(Math.sin(k * Math.PI * 2)) * away * -40, opacity: clamp01(k * 3) };
    default:
      return NO_MOTION;
  }
}

function during(kind: string, ms: number, amount: number): ClipMotion {
  const a = amount;
  switch (kind) {
    case "pulse":
      return { ...NO_MOTION, scale: 1 + 0.05 * a * Math.sin((ms / 800) * Math.PI * 2) };
    case "float":
      return { ...NO_MOTION, dy: 14 * a * Math.sin((ms / 2000) * Math.PI * 2) };
    case "shake":
      return { ...NO_MOTION, dx: 7 * a * Math.sin((ms / 110) * Math.PI * 2) };
    case "sway":
      return { ...NO_MOTION, rotation: 3 * a * Math.sin((ms / 1600) * Math.PI * 2) };
    case "spin":
      return { ...NO_MOTION, rotation: ((ms / 4000) * 360 * a) % 360 };
    default:
      return NO_MOTION;
  }
}

const combine = (a: ClipMotion, b: ClipMotion): ClipMotion => ({ dx: a.dx + b.dx, dy: a.dy + b.dy, scale: a.scale * b.scale, rotation: a.rotation + b.rotation, opacity: a.opacity * b.opacity });

/** The clip's whole motion at a moment. `size` is the canvas (fly-ins start off screen). */
export function clipMotionAt(clip: Clip, localMs: number, size: { width: number; height: number }): ClipMotion {
  let motion = keyframesAt(clip.keyframes, localMs);
  const b = clip.behavior;
  if (b) {
    if (b.in !== "none") motion = combine(motion, entrance(b.in, easeOut(clamp01(localMs / Math.max(1, b.inMs))), size));
    if (b.during !== "none") motion = combine(motion, during(b.during, localMs, b.amount));
    if (b.out !== "none") motion = combine(motion, entrance(b.out, easeIn(clamp01((clip.durationMs - localMs) / Math.max(1, b.outMs))), size));
  }
  return motion;
}

/** Keyframe times are relative to the clip's own start, so they follow it when it moves. */
export function setKeyframe(clip: Clip, localMs: number, values: Partial<ClipMotion> & { ease?: KeyframeLike["ease"] }): NonNullable<Clip["keyframes"]> {
  const list = clip.keyframes ?? [];
  const at = Math.max(0, Math.min(clip.durationMs, Math.round(localMs)));
  const here = keyframesAt(list, at);
  const existing = list.find((k) => Math.abs(k.t - at) < 34);
  const next: KeyframeLike = {
    t: existing?.t ?? at,
    x: values.dx ?? existing?.x ?? here.dx,
    y: values.dy ?? existing?.y ?? here.dy,
    scale: values.scale ?? existing?.scale ?? here.scale,
    rotation: values.rotation ?? existing?.rotation ?? here.rotation,
    opacity: values.opacity ?? existing?.opacity ?? here.opacity,
    ease: values.ease ?? existing?.ease ?? "smooth",
  };
  return [...list.filter((k) => k !== existing), next].sort((a, b) => a.t - b.t);
}

/** Volume multiplier from a clip's volume points (straight lines between points). */
export function volumeAt(clip: Pick<Clip, "volumePoints">, localMs: number): number {
  const pts = clip.volumePoints;
  if (!pts?.length) return 1;
  const sorted = [...pts].sort((a, b) => a.t - b.t);
  if (localMs <= sorted[0]!.t) return sorted[0]!.gain;
  for (let i = 1; i < sorted.length; i++) {
    const b = sorted[i]!;
    if (localMs > b.t) continue;
    const a = sorted[i - 1]!;
    return a.gain + (b.gain - a.gain) * clamp01((localMs - a.t) / Math.max(1, b.t - a.t));
  }
  return sorted[sorted.length - 1]!.gain;
}
