/**
 * Clip transitions and text animations as pure functions of time.
 */
import type { Clip, Transition } from "../project/schema";
import { breakSegments } from "../text/lineBreak";
import { cubicBezier, EASING_CURVES } from "./easing";

const ease = cubicBezier(EASING_CURVES.smooth);
const easeInOut = cubicBezier(EASING_CURVES.gentle);

export interface TransitionState {
  alpha: number;
  /** Offset as a fraction of the stage size. */
  dx: number;
  dy: number;
  scale: number;
  /** 0..1 revealed fraction for wipes (left to right); 1 = fully shown. */
  wipe: number;
  /** Blur strength in stage pixels. */
  blur: number;
}

export const NO_TRANSITION: TransitionState = { alpha: 1, dx: 0, dy: 0, scale: 1, wipe: 1, blur: 0 };

/** p goes 0 -> 1 as the clip appears (for "out", p goes 1 -> 0 as it disappears). */
function shape(t: Transition, p: number, entering: boolean): TransitionState {
  const e = entering ? ease(p) : easeInOut(p);
  switch (t.type) {
    case "fade":
    case "dissolve":
      return { ...NO_TRANSITION, alpha: e };
    case "slide-left":
      return { ...NO_TRANSITION, dx: (1 - e) * (entering ? 1 : -1) };
    case "slide-right":
      return { ...NO_TRANSITION, dx: (1 - e) * (entering ? -1 : 1) };
    case "slide-up":
      return { ...NO_TRANSITION, dy: (1 - e) * (entering ? 1 : -1) };
    case "slide-down":
      return { ...NO_TRANSITION, dy: (1 - e) * (entering ? -1 : 1) };
    case "wipe":
      return { ...NO_TRANSITION, wipe: e };
    case "zoom":
      return { ...NO_TRANSITION, alpha: e, scale: 0.6 + 0.4 * e };
    case "blur":
      return { ...NO_TRANSITION, alpha: e, blur: (1 - e) * 40 };
  }
}

function combine(a: TransitionState, b: TransitionState): TransitionState {
  return { alpha: a.alpha * b.alpha, dx: a.dx + b.dx, dy: a.dy + b.dy, scale: a.scale * b.scale, wipe: Math.min(a.wipe, b.wipe), blur: a.blur + b.blur };
}

/** Transition effect on a clip at timeline time t. */
export function transitionAt(clip: Clip, t: number): TransitionState {
  let state = NO_TRANSITION;
  const local = t - clip.startMs;
  const tin = clip.transitionIn;
  if (tin && local < tin.durationMs) state = combine(state, shape(tin, Math.max(0, local / tin.durationMs), true));
  const tout = clip.transitionOut;
  const left = clip.durationMs - local;
  if (tout && left < tout.durationMs) state = combine(state, shape(tout, Math.max(0, left / tout.durationMs), false));
  return state;
}

/** For a dissolve-in: the clip that ends where this one starts on the same lane (within a frame). */
export function dissolvePartner(clips: Clip[], clip: Clip, frameMs = 34): Clip | undefined {
  if (clip.transitionIn?.type !== "dissolve") return undefined;
  return clips.find((c) => c.trackId === clip.trackId && c.id !== clip.id && Math.abs(c.startMs + c.durationMs - clip.startMs) <= frameMs);
}

// ---------------------------------------------------------------- text animation

export interface TextAnimState {
  /** Text to show (typewriter shows a prefix of whole syllables/graphemes). */
  text: string;
  alpha: number;
  /** Offset in font-size units (rise). */
  dy: number;
  scale: number;
  /** 0..1 revealed fraction (wipe). */
  wipe: number;
}

const TEXT_ANIM_MS = 700;

/** Units the typewriter reveals: whole Tibetan syllables, Latin graphemes. */
export function revealUnits(text: string): string[] {
  if (/[ༀ-࿿]/.test(text)) return breakSegments(text);
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) return [...new Seg(undefined, { granularity: "grapheme" }).segment(text)].map((s) => s.segment);
  return Array.from(text);
}

export function textAnimationAt(text: string, animation: string, localMs: number): TextAnimState {
  const base = { text, alpha: 1, dy: 0, scale: 1, wipe: 1 };
  if (animation === "none" || localMs >= TEXT_ANIM_MS * 3) return base;
  const p = Math.min(1, Math.max(0, localMs / TEXT_ANIM_MS));
  const e = ease(p);
  switch (animation) {
    case "fade":
      return { ...base, alpha: e };
    case "rise":
      return { ...base, alpha: e, dy: (1 - e) * 0.6 };
    case "pop": {
      // Slight overshoot.
      const s = p < 1 ? 0.6 + 0.4 * e + Math.sin(p * Math.PI) * 0.08 : 1;
      return { ...base, alpha: Math.min(1, p * 2), scale: s };
    }
    case "wipe":
      return { ...base, wipe: e };
    case "typewriter": {
      const units = revealUnits(text);
      // Typewriter speed scales with length (≈ 3 × the base duration in total).
      const total = Math.max(TEXT_ANIM_MS, Math.min(TEXT_ANIM_MS * 3, units.length * 45));
      const n = Math.min(units.length, Math.floor((localMs / total) * units.length) + 1);
      return { ...base, text: units.slice(0, n).join("") };
    }
    default:
      return base;
  }
}
