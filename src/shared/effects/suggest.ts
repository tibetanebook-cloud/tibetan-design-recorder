/**
 * Auto-zoom suggestions from the cursor/click/keystroke metadata track.
 *
 * 1. Classify each click by what happened around it (double-click, text selection,
 *    dropdown, text field, generic) and give it a strength.
 * 2. Typing bursts (≥ 1 s of key events) are weaker candidates at the last click.
 * 3. Cluster events within CLUSTER_MS; focus = strongest member.
 * 4. Span = first event − PAD_MS … last event + PAD_MS, clamped; spans that overlap
 *    existing zooms are dropped. Each span becomes a suggested auto region, depth 2.
 */
import { newId } from "../project/factory";
import type { ZoomRegion } from "../project/schema";
import type { CursorTrack, InputEvent } from "../recording/types";
import { positionAt, type Pt } from "./cursor";

export interface SuggestOptions {
  clusterMs: number;
  padMs: number;
  minStrength: number;
}

export const DEFAULT_SUGGEST: SuggestOptions = { clusterMs: 2500, padMs: 500, minStrength: 0 };

export type ClickClass = "double" | "text-selection" | "dropdown" | "text-field" | "click" | "typing";
const STRENGTH: Record<ClickClass, number> = { double: 1500, "text-selection": 1300, dropdown: 1200, "text-field": 1100, click: 900, typing: 800 };

interface Candidate {
  t: number;
  focus: Pt;
  cls: ClickClass;
  strength: number;
}

type Down = Extract<InputEvent, { button: number }>;

export function classifyClick(track: CursorTrack, down: Down, prev?: Down): ClickClass {
  if (down.clicks >= 2 || (prev && down.t - prev.t <= 350 && Math.hypot(down.x - prev.x, down.y - prev.y) <= 0.04)) return "double";
  const up = track.events.find((e): e is Extract<InputEvent, { button: number }> => e.type === "up" && e.t >= down.t && e.t - down.t <= 3000);
  if (up) {
    const held = up.t - down.t;
    const dx = Math.abs(up.x - down.x), dy = Math.abs(up.y - down.y);
    if (held >= 200 && dx > 0.03 && dx > 1.8 * dy) return "text-selection";
  }
  // What the cursor did over the next 0.1–2 s.
  const after = track.samples.filter(([t]) => t >= down.t + 100 && t <= down.t + 2000);
  if (after.length) {
    const last = after.at(-1)!;
    const ddx = Math.abs(last[1] - down.x), ddy = last[2] - down.y;
    if (ddy > 0.03 && Math.abs(ddy) > 1.5 * ddx) return "dropdown";
    const drift = Math.max(...after.map(([, x, y]) => Math.hypot(x - down.x, y - down.y)));
    if (after.length < 3 || drift < 0.02) return "text-field";
  }
  return "click";
}

/** Runs of key events with < 700 ms between them, lasting ≥ 1 s. */
function typingBursts(track: CursorTrack): { start: number; end: number }[] {
  const keys = track.events.filter((e) => e.type === "key").map((e) => e.t);
  const bursts: { start: number; end: number }[] = [];
  let start = -1, last = -1;
  for (const t of keys) {
    if (start < 0 || t - last > 700) {
      if (start >= 0 && last - start >= 1000) bursts.push({ start, end: last });
      start = t;
    }
    last = t;
  }
  if (start >= 0 && last - start >= 1000) bursts.push({ start, end: last });
  return bursts;
}

export interface SuggestResult {
  status: "no-telemetry" | "no-interactions" | "no-free-slots" | "ok";
  zooms: ZoomRegion[];
}

/**
 * `offsetMs` places track time on the timeline (cursor clip start − its in-point);
 * `durationMs` is the timeline length used for clamping.
 */
export function suggestZooms(track: CursorTrack | null, existing: ZoomRegion[], durationMs: number, offsetMs = 0, opts: SuggestOptions = DEFAULT_SUGGEST): SuggestResult {
  if (!track || !track.samples.length) return { status: "no-telemetry", zooms: [] };
  const downs = track.events.filter((e): e is Down => e.type === "down" && e.button !== 2);
  const candidates: Candidate[] = downs.map((d, i) => {
    const cls = classifyClick(track, d, downs[i - 1]);
    return { t: d.t, focus: { x: d.x, y: d.y }, cls, strength: STRENGTH[cls] };
  });
  for (const b of typingBursts(track)) {
    const lastClick = [...downs].reverse().find((d) => d.t <= b.start);
    const focus = lastClick ? { x: lastClick.x, y: lastClick.y } : positionAt(track, b.start) ?? { x: 0.5, y: 0.5 };
    candidates.push({ t: b.start, focus, cls: "typing", strength: STRENGTH.typing }, { t: b.end, focus, cls: "typing", strength: STRENGTH.typing });
  }
  const usable = candidates.filter((c) => c.strength >= opts.minStrength).sort((a, b) => a.t - b.t);
  if (!usable.length) return { status: "no-interactions", zooms: [] };

  const clusters: Candidate[][] = [];
  for (const c of usable) {
    const last = clusters.at(-1);
    if (last && c.t - last.at(-1)!.t <= opts.clusterMs) last.push(c);
    else clusters.push([c]);
  }

  const taken = existing.filter((z) => !z.suggested);
  const zooms: ZoomRegion[] = [];
  for (const cluster of clusters) {
    const start = Math.max(0, cluster[0]!.t + offsetMs - opts.padMs);
    const end = Math.min(durationMs, cluster.at(-1)!.t + offsetMs + opts.padMs);
    if (end - start < 300) continue;
    if ([...taken, ...zooms].some((z) => z.startMs < end && z.endMs > start)) continue;
    const best = cluster.reduce((a, b) => (b.strength > a.strength ? b : a));
    zooms.push({ id: newId("zm"), startMs: Math.round(start), endMs: Math.round(end), depth: 2, focus: best.focus, mode: "auto", suggested: true });
  }
  return { status: zooms.length ? "ok" : "no-free-slots", zooms };
}
