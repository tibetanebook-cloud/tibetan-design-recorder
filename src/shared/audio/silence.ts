/**
 * Finding speech pauses in a recording's loudness peaks, and what to do with them:
 * cut the long ones out, or lower background music while someone is talking.
 */
import type { Clip } from "../project/schema";

export interface TimeRange {
  startMs: number;
  endMs: number;
}

export interface SilenceOptions {
  /** Peaks per second of the data. */
  rate: number;
  /** Below this share of the loudest peak counts as quiet (0–1). */
  threshold: number;
  /** Only pauses at least this long. */
  minMs: number;
  /** Keep this much of the pause at each side, so cuts don't clip words. */
  keepMs: number;
}

export const DEFAULT_SILENCE: Omit<SilenceOptions, "rate"> = { threshold: 0.06, minMs: 800, keepMs: 150 };

/** Quiet stretches, in source-file time, shortened by keepMs at each side. */
export function findSilences(peaks: ArrayLike<number>, options: SilenceOptions): TimeRange[] {
  let loudest = 0;
  for (let i = 0; i < peaks.length; i++) if (peaks[i]! > loudest) loudest = peaks[i]!;
  if (loudest <= 0) return [];
  const limit = loudest * options.threshold;
  const out: TimeRange[] = [];
  let start = -1;
  const close = (end: number) => {
    const a = (start / options.rate) * 1000, b = (end / options.rate) * 1000;
    if (b - a >= options.minMs && b - a > options.keepMs * 2) out.push({ startMs: a + options.keepMs, endMs: b - options.keepMs });
    start = -1;
  };
  for (let i = 0; i < peaks.length; i++) {
    if (peaks[i]! < limit) {
      if (start < 0) start = i;
    } else if (start >= 0) close(i);
  }
  if (start >= 0) close(peaks.length);
  return out;
}

/** Source-time ranges of a clip, as timeline ranges (only what the clip really plays). */
export function sourceRangesToTimeline(clip: Pick<Clip, "startMs" | "durationMs" | "sourceInMs" | "speed">, ranges: TimeRange[]): TimeRange[] {
  const out: TimeRange[] = [];
  for (const r of ranges) {
    const a = clip.startMs + (r.startMs - clip.sourceInMs) / clip.speed;
    const b = clip.startMs + (r.endMs - clip.sourceInMs) / clip.speed;
    const startMs = Math.max(a, clip.startMs), endMs = Math.min(b, clip.startMs + clip.durationMs);
    if (endMs > startMs) out.push({ startMs, endMs });
  }
  return out;
}

/** Sort and join overlapping ranges. */
export function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = [...ranges].sort((a, b) => a.startMs - b.startMs);
  const out: TimeRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.startMs <= last.endMs) last.endMs = Math.max(last.endMs, r.endMs);
    else out.push({ ...r });
  }
  return out;
}

/**
 * Volume points that lower a music clip while the voice is speaking.
 * `quiet` = the voice's pauses, in timeline time; `ramp` smooths each change.
 */
export function duckingPoints(clip: Pick<Clip, "startMs" | "durationMs">, quiet: TimeRange[], lowered: number, ramp = 300): { t: number; gain: number }[] {
  const end = clip.startMs + clip.durationMs;
  const open = mergeRanges(quiet)
    .map((r) => ({ startMs: Math.max(r.startMs, clip.startMs), endMs: Math.min(r.endMs, end) }))
    // A pause too short to rise and fall again stays lowered.
    .filter((r) => r.endMs - r.startMs > ramp * 2);
  const pts: { t: number; gain: number }[] = [];
  let cursor = clip.startMs;
  const add = (t: number, gain: number) => pts.push({ t: Math.round(t - clip.startMs), gain });
  add(cursor, open[0]?.startMs === clip.startMs ? 1 : lowered);
  for (const r of open) {
    if (r.startMs > cursor) add(r.startMs, lowered);
    add(r.startMs + ramp, 1);
    add(r.endMs - ramp, 1);
    add(r.endMs, lowered);
    cursor = r.endMs;
  }
  if (cursor < end) add(end, lowered);
  return pts;
}
