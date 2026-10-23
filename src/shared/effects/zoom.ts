/**
 * Camera zoom from zoom regions, as a pure function of time.
 *
 * Strength envelope per region (0 -> 1 -> 0), evaluated 200 ms late so the camera
 * reacts just after the action: ramp in over zoomInMs ending 1 s after the region
 * starts, hold until 500 ms before it ends, ramp out over zoomOutMs. If ramps
 * overlap they meet halfway (triangle). Regions closer than 1350 ms are "connected":
 * the camera glides from one to the next without zooming out in between.
 *
 * Output is a camera in stage pixels: `scale` and the stage point shown at the
 * stage centre. Springs smooth scale and position (pure: see spring.ts), and the
 * view is clamped so the canvas always covers the stage.
 */
import { ZOOM_DEPTH_SCALE, type Project, type ZoomRegion, type ZoomSettings } from "../project/schema";
import { cubicBezier, curveFor } from "./easing";
import { cameraSpring, springAt } from "./spring";
import type { Pt } from "./cursor";

export const ZOOM_LAG_MS = 200;
export const CONNECT_GAP_MS = 1350;
const HOLD_BEFORE_END_MS = 500;
const TRANSITION_START_MS = 200;
const TRANSITION_END_MS = 1200;

export interface Camera {
  scale: number;
  /** Stage point shown at the stage centre. */
  cx: number;
  cy: number;
}

export const depthScale = (depth: number): number => ZOOM_DEPTH_SCALE[Math.min(6, Math.max(1, Math.round(depth)))]!;

/** Accepted regions, sorted, grouped into connected runs. */
export function zoomGroups(zooms: ZoomRegion[], settings: ZoomSettings): ZoomRegion[][] {
  const regions = zooms.filter((z) => !z.suggested && z.endMs > z.startMs).sort((a, b) => a.startMs - b.startMs);
  const groups: ZoomRegion[][] = [];
  for (const r of regions) {
    const g = groups.at(-1);
    if (g && settings.connect && r.startMs - g.at(-1)!.endMs <= CONNECT_GAP_MS) g.push(r);
    else groups.push([r]);
  }
  return groups;
}

/** 0..1 strength of a group (first region's ramp-in to last region's ramp-out). */
export function groupStrength(group: ZoomRegion[], t: number, s: ZoomSettings, ease: (x: number) => number): number {
  const tl = t - ZOOM_LAG_MS;
  const start = group[0]!.startMs;
  const end = group.at(-1)!.endMs;
  const inStart = start + (1000 - s.zoomInMs);
  const inEnd = inStart + s.zoomInMs;
  const holdEnd = end - HOLD_BEFORE_END_MS;
  const outEnd = holdEnd + s.zoomOutMs;
  if (tl <= inStart || tl >= outEnd) return 0;
  const rampIn = (time: number) => ease(Math.min(1, (time - inStart) / s.zoomInMs));
  if (inEnd <= holdEnd) {
    if (tl < holdEnd) return rampIn(tl);
    return 1 - ease((tl - holdEnd) / s.zoomOutMs);
  }
  // Ramps overlap: meet halfway.
  const mid = (inStart + outEnd) / 2;
  if (tl < mid) return rampIn(tl);
  return rampIn(mid) * (1 - ease((tl - mid) / (outEnd - mid)));
}

/** Which region of a connected group is current (with a 0..1 blend into the next). */
function groupPhase(group: ZoomRegion[], t: number, ease: (x: number) => number): { a: ZoomRegion; b: ZoomRegion; k: number } {
  const tl = t - ZOOM_LAG_MS;
  for (let i = 0; i < group.length - 1; i++) {
    const a = group[i]!, b = group[i + 1]!;
    const from = a.endMs + TRANSITION_START_MS, to = a.endMs + TRANSITION_END_MS;
    if (tl < from) return { a, b: a, k: 0 };
    if (tl < to) return { a, b, k: ease((tl - from) / (to - from)) };
  }
  const last = group.at(-1)!;
  return { a: last, b: last, k: 0 };
}

export interface CameraContext {
  stage: { width: number; height: number };
  /** Screen-source point (0–1) -> stage pixels, through the screen clip's crop/fit/frame. */
  toStage: (p: Pt) => Pt;
  /** Width of the screen picture on stage, as a fraction of the stage width. */
  screenFraction: number;
  /** Smoothed cursor position (source space) at a timeline time, for auto regions. */
  cursorAt?: (t: number) => Pt | null;
}

/** Auto regions: focus follows the cursor once it leaves a dead zone (simulated, cached). */
const followCache = new WeakMap<ZoomRegion, { key: string; samples: Float32Array; t0: number }>();
const FOLLOW_STEP_MS = 1000 / 30;

function autoFocus(region: ZoomRegion, t: number, scale: number, ctx: CameraContext): Pt {
  if (!ctx.cursorAt) return region.focus;
  const key = `${scale.toFixed(3)}|${ctx.screenFraction.toFixed(3)}`;
  let cached = followCache.get(region);
  if (!cached || cached.key !== key) {
    const half = Math.min(0.5, 0.5 / scale / Math.max(0.1, ctx.screenFraction));
    const dead = half * 0.5; // viewport shrunk by 25 % on each side
    const t0 = region.startMs - 1000;
    const n = Math.ceil((region.endMs + 1500 - t0) / FOLLOW_STEP_MS) + 1;
    const samples = new Float32Array(n * 2);
    const first = ctx.cursorAt(region.startMs) ?? region.focus;
    let fx = first.x, fy = first.y;
    for (let i = 0; i < n; i++) {
      const time = t0 + i * FOLLOW_STEP_MS;
      // Freeze while zooming back out.
      if (time < region.endMs - HOLD_BEFORE_END_MS) {
        const c = ctx.cursorAt(time);
        if (c) {
          if (c.x < fx - dead || c.x > fx + dead) fx = c.x;
          if (c.y < fy - dead || c.y > fy + dead) fy = c.y;
        }
      }
      fx = Math.min(1 - half, Math.max(half, fx));
      fy = Math.min(1 - half, Math.max(half, fy));
      samples[i * 2] = fx;
      samples[i * 2 + 1] = fy;
    }
    cached = { key, samples, t0 };
    followCache.set(region, cached);
  }
  const i = Math.min(cached.samples.length / 2 - 1, Math.max(0, Math.round((t - cached.t0) / FOLLOW_STEP_MS)));
  return { x: cached.samples[i * 2]!, y: cached.samples[i * 2 + 1]! };
}

/** Unsmoothed camera target at time t. */
export function cameraTarget(project: Project, t: number, ctx: CameraContext): Camera {
  const s = project.zoom;
  const ease = cubicBezier(curveFor(s));
  const W = ctx.stage.width, H = ctx.stage.height;
  const identity: Camera = { scale: 1, cx: W / 2, cy: H / 2 };
  for (const group of zoomGroups(project.zooms, s)) {
    const strength = groupStrength(group, t, s, ease);
    if (strength <= 0) continue;
    const { a, b, k } = groupPhase(group, t, ease);
    const focusOf = (r: ZoomRegion) => (r.mode === "auto" ? autoFocus(r, t, depthScale(r.depth), ctx) : r.focus);
    const fa = ctx.toStage(focusOf(a)), fb = ctx.toStage(focusOf(b));
    const depth = depthScale(a.depth) + (depthScale(b.depth) - depthScale(a.depth)) * k;
    const focus = { x: fa.x + (fb.x - fa.x) * k, y: fa.y + (fb.y - fa.y) * k };
    const scale = 1 + (depth - 1) * strength;
    // Move the focus towards the centre in proportion to the strength.
    const cx = focus.x + ((1 - strength) * (W / 2 - focus.x)) / scale;
    const cy = focus.y + ((1 - strength) * (H / 2 - focus.y)) / scale;
    return clampCamera({ scale, cx, cy }, W, H);
  }
  return identity;
}

/** Keep the zoomed canvas covering the whole stage. */
export function clampCamera(c: Camera, W: number, H: number): Camera {
  const hx = W / (2 * c.scale), hy = H / (2 * c.scale);
  return { scale: c.scale, cx: Math.min(W - hx, Math.max(hx, c.cx)), cy: Math.min(H - hy, Math.max(hy, c.cy)) };
}

/** Smoothed camera at time t (springs on scale and position). */
export function cameraAt(project: Project, t: number, ctx: CameraContext): Camera {
  if (!project.zooms.some((z) => !z.suggested)) return { scale: 1, cx: ctx.stage.width / 2, cy: ctx.stage.height / 2 };
  const params = cameraSpring(project.zoom.smoothness);
  if (!params) return cameraTarget(project, t, ctx);
  // Memoize targets within this evaluation (three springs read the same times).
  const memo = new Map<number, Camera>();
  const target = (time: number) => {
    let c = memo.get(time);
    if (!c) memo.set(time, (c = cameraTarget(project, time, ctx)));
    return c;
  };
  const scale = springAt((time) => target(time).scale, t, params, 1500);
  const cx = springAt((time) => target(time).cx, t, params, 1500);
  const cy = springAt((time) => target(time).cy, t, params, 1500);
  return clampCamera({ scale: Math.max(1, scale), cx, cy }, ctx.stage.width, ctx.stage.height);
}
