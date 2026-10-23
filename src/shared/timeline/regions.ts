/**
 * Zoom regions (camera lane) and speed regions.
 *
 * A speed region is a time warp over [startMs, endMs): everything inside plays
 * `factor` times faster (or slower), everything after moves accordingly. It is
 * applied to every unlocked lane at once so screen, webcam, mic, system audio and
 * cursor stay in sync; markers and zoom regions are warped the same way.
 */
import { newId } from "../project/factory";
import type { Clip, Project, ZoomRegion } from "../project/schema";
import { clipEnd, isEditable, MAX_SPEED, MIN_CLIP_MS, MIN_SPEED, splitAt } from "./ops";

export const SPEED_PRESETS = [0.25, 0.5, 0.75, 1.25, 1.5, 1.75, 2] as const;
export const DEFAULT_SPEED_UP = 1.5;
export const DEFAULT_SLOW_DOWN = 0.5;
const MIN_ZOOM_MS = 300;

// ---------------------------------------------------------------- zoom regions

export function addZoom(p: Project, startMs: number, endMs: number, patch: Partial<ZoomRegion> = {}): { project: Project; id: string } {
  const start = Math.max(0, Math.min(startMs, endMs));
  const end = Math.max(start + MIN_ZOOM_MS, Math.max(startMs, endMs));
  // Don't overlap: start after any region that begins at or before `start`
  // (including one that contains it), and stop at the next region.
  const others = p.zooms.filter((z) => !z.suggested);
  const prevEnd = Math.max(0, ...others.filter((z) => z.startMs <= start).map((z) => z.endMs));
  const nextStart = Math.min(Infinity, ...others.filter((z) => z.startMs > start).map((z) => z.startMs));
  const s = Math.max(start, prevEnd);
  const e = Math.min(end, nextStart);
  if (e - s < MIN_ZOOM_MS) return { project: p, id: "" };
  const zoom: ZoomRegion = { id: newId("zm"), startMs: s, endMs: e, depth: 2, focus: { x: 0.5, y: 0.5 }, mode: "manual", suggested: false, ...patch };
  return { project: { ...p, zooms: [...p.zooms, zoom].sort((a, b) => a.startMs - b.startMs) }, id: zoom.id };
}

export function updateZoom(p: Project, id: string, patch: Partial<Omit<ZoomRegion, "id">>): Project {
  const z = p.zooms.find((x) => x.id === id);
  if (!z) return p;
  const next = { ...z, ...patch };
  next.startMs = Math.max(0, next.startMs);
  if (next.endMs - next.startMs < MIN_ZOOM_MS) next.endMs = next.startMs + MIN_ZOOM_MS;
  next.depth = Math.min(6, Math.max(1, Math.round(next.depth)));
  next.focus = { x: Math.min(1, Math.max(0, next.focus.x)), y: Math.min(1, Math.max(0, next.focus.y)) };
  return { ...p, zooms: p.zooms.map((x) => (x.id === id ? next : x)).sort((a, b) => a.startMs - b.startMs) };
}

/** Move a zoom region by delta, stopping at neighbours. */
export function moveZoom(p: Project, id: string, deltaMs: number): Project {
  const z = p.zooms.find((x) => x.id === id);
  if (!z) return p;
  const others = p.zooms.filter((x) => x.id !== id && !x.suggested);
  const prevEnd = Math.max(0, ...others.filter((x) => x.endMs <= z.startMs + 1).map((x) => x.endMs));
  const nextStart = Math.min(Infinity, ...others.filter((x) => x.startMs >= z.endMs - 1).map((x) => x.startMs));
  const d = Math.min(nextStart - z.endMs, Math.max(prevEnd - z.startMs, deltaMs));
  return updateZoom(p, id, { startMs: z.startMs + d, endMs: z.endMs + d });
}

/** Drag a zoom edge to a time, stopping at neighbours and keeping a minimum length. */
export function resizeZoom(p: Project, id: string, edge: "start" | "end", timeMs: number): Project {
  const z = p.zooms.find((x) => x.id === id);
  if (!z) return p;
  const others = p.zooms.filter((x) => x.id !== id && !x.suggested);
  if (edge === "start") {
    const prevEnd = Math.max(0, ...others.filter((x) => x.endMs <= z.startMs + 1).map((x) => x.endMs));
    return updateZoom(p, id, { startMs: Math.min(z.endMs - MIN_ZOOM_MS, Math.max(prevEnd, timeMs)) });
  }
  const nextStart = Math.min(Infinity, ...others.filter((x) => x.startMs >= z.endMs - 1).map((x) => x.startMs));
  return updateZoom(p, id, { endMs: Math.max(z.startMs + MIN_ZOOM_MS, Math.min(nextStart, timeMs)) });
}

export const removeZoom = (p: Project, id: string): Project => ({ ...p, zooms: p.zooms.filter((z) => z.id !== id) });

/** Accept suggestions (all, or given ids); rejected ones are simply removed. */
export function acceptSuggestions(p: Project, ids?: string[]): Project {
  return { ...p, zooms: p.zooms.map((z) => (z.suggested && (!ids || ids.includes(z.id)) ? { ...z, suggested: false } : z)) };
}

export function rejectSuggestions(p: Project, ids?: string[]): Project {
  return { ...p, zooms: p.zooms.filter((z) => !(z.suggested && (!ids || ids.includes(z.id)))) };
}

/** Replace previous suggestions with new ones. */
export function setSuggestions(p: Project, zooms: ZoomRegion[]): Project {
  return { ...p, zooms: [...p.zooms.filter((z) => !z.suggested), ...zooms].sort((a, b) => a.startMs - b.startMs) };
}

// ---------------------------------------------------------------- speed regions

/** Timeline time after the warp. */
export function warpTime(t: number, startMs: number, endMs: number, factor: number): number {
  if (t <= startMs) return t;
  if (t >= endMs) return t - (endMs - startMs) * (1 - 1 / factor);
  return startMs + (t - startMs) / factor;
}

/**
 * Play [startMs, endMs) `factor` × as fast on every unlocked lane (factor > 1 speeds
 * up, < 1 slows down). Clips are split at the region edges first.
 */
export function applySpeedRegion(p: Project, startMs: number, endMs: number, factor: number): Project {
  if (endMs - startMs < MIN_CLIP_MS || factor <= 0 || factor === 1) return p;
  let project = splitAt(p, startMs);
  project = splitAt(project, endMs);
  const warp = (t: number) => warpTime(t, startMs, endMs, factor);
  const clips: Clip[] = project.clips.map((c) => {
    if (!isEditable(project, c)) return c;
    const inside = c.startMs >= startMs - 0.5 && clipEnd(c) <= endMs + 0.5;
    const newStart = warp(c.startMs);
    if (!inside) return { ...c, startMs: newStart };
    const speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, c.speed * factor));
    return {
      ...c,
      startMs: newStart,
      speed,
      durationMs: Math.max(MIN_CLIP_MS, (c.durationMs * c.speed) / speed),
      fadeInMs: Math.min(c.fadeInMs, (c.durationMs * c.speed) / speed),
      fadeOutMs: Math.min(c.fadeOutMs, (c.durationMs * c.speed) / speed),
    };
  });
  return {
    ...project,
    clips,
    markers: project.markers.map((m) => ({ ...m, timeMs: warp(m.timeMs) })),
    zooms: project.zooms.map((z) => ({ ...z, startMs: warp(z.startMs), endMs: Math.max(warp(z.startMs) + MIN_ZOOM_MS, warp(z.endMs)) })),
  };
}
