/**
 * Edits that work on a stretch of the whole timeline rather than on one clip:
 * cut a range out and close the gap (in/out range, a spoken sentence, a pause),
 * make room, close gaps on a lane, hold a frame, and copy a clip's look to others.
 */
import { newId } from "../project/factory";
import type { Clip, Marker, Project, ZoomRegion } from "../project/schema";
import { clipEnd, isEditable, trackById } from "./ops";
import { mergeRanges, type TimeRange } from "../audio/silence";

const MIN_MS = 16;

/** Where a timeline time lands once a range is removed. */
function shift(t: number, r: TimeRange): number {
  return t <= r.startMs ? t : t >= r.endMs ? t - (r.endMs - r.startMs) : r.startMs;
}

function cutClip(c: Clip, r: TimeRange, length: number): Clip[] {
  const end = clipEnd(c);
  if (end <= r.startMs) return [c];
  if (c.startMs >= r.endMs) return [{ ...c, startMs: c.startMs - length }];
  if (c.startMs >= r.startMs && end <= r.endMs) return [];
  // Cut through the clip: the left part stays, the right part moves back and keeps playing from the right place.
  const out: Clip[] = [];
  if (c.startMs < r.startMs && r.startMs - c.startMs >= MIN_MS) out.push({ ...c, durationMs: r.startMs - c.startMs, fadeOutMs: 0 });
  if (end > r.endMs && end - r.endMs >= MIN_MS) {
    const skipped = r.endMs - c.startMs;
    out.push({ ...c, id: out.length ? newId("clp") : c.id, startMs: r.startMs, durationMs: end - r.endMs, sourceInMs: c.freeze ? c.sourceInMs : c.sourceInMs + skipped * c.speed, fadeInMs: 0 });
  }
  return out;
}

/** Remove one stretch of time from every unlocked lane and close the gap. */
export function deleteRange(p: Project, range: TimeRange): Project {
  const length = range.endMs - range.startMs;
  if (length <= 0) return p;
  const clips = p.clips.flatMap((c) => {
    const lane = trackById(p, c.trackId);
    return c.locked || lane?.locked ? [c] : cutClip(c, range, length);
  });
  const markers: Marker[] = p.markers.filter((m) => m.timeMs <= range.startMs || m.timeMs >= range.endMs).map((m) => ({ ...m, timeMs: shift(m.timeMs, range) }));
  const zooms: ZoomRegion[] = p.zooms
    .map((z) => ({ ...z, startMs: shift(z.startMs, range), endMs: shift(z.endMs, range) }))
    .filter((z) => z.endMs - z.startMs > MIN_MS);
  const layouts = p.layouts.map((l) => ({ ...l, startMs: shift(l.startMs, range) }));
  return { ...p, clips, markers, zooms, layouts };
}

/** Remove several stretches (latest first, so earlier times stay valid). */
export function deleteRanges(p: Project, ranges: TimeRange[]): Project {
  return mergeRanges(ranges).reverse().reduce((q, r) => deleteRange(q, r), p);
}

/** Push everything at or after `atMs` later, on every unlocked lane, splitting clips across it. */
export function insertTime(p: Project, atMs: number, lengthMs: number): Project {
  if (lengthMs <= 0) return p;
  const clips = p.clips.flatMap((c) => {
    const lane = trackById(p, c.trackId);
    if (c.locked || lane?.locked) return [c];
    const end = clipEnd(c);
    if (end <= atMs) return [c];
    if (c.startMs >= atMs) return [{ ...c, startMs: c.startMs + lengthMs }];
    const left = atMs - c.startMs;
    return [
      { ...c, durationMs: left, fadeOutMs: 0 },
      { ...c, id: newId("clp"), startMs: atMs + lengthMs, durationMs: c.durationMs - left, sourceInMs: c.freeze ? c.sourceInMs : c.sourceInMs + left * c.speed, fadeInMs: 0 },
    ];
  });
  const later = (t: number) => (t >= atMs ? t + lengthMs : t);
  return {
    ...p,
    clips,
    markers: p.markers.map((m) => ({ ...m, timeMs: later(m.timeMs) })),
    zooms: p.zooms.map((z) => ({ ...z, startMs: later(z.startMs), endMs: later(z.endMs) })),
    layouts: p.layouts.map((l) => ({ ...l, startMs: later(l.startMs) })),
  };
}

/** Slide a lane's clips left so no empty space remains between them. */
export function closeGaps(p: Project, trackId: string): Project {
  if (trackById(p, trackId)?.locked) return p;
  let cursor = 0;
  const moved = new Map<string, number>();
  for (const c of p.clips.filter((x) => x.trackId === trackId).sort((a, b) => a.startMs - b.startMs)) {
    if (c.locked) {
      cursor = clipEnd(c);
      continue;
    }
    moved.set(c.id, cursor);
    cursor += c.durationMs;
  }
  return { ...p, clips: p.clips.map((c) => (moved.has(c.id) ? { ...c, startMs: moved.get(c.id)! } : c)) };
}

/**
 * Hold the picture of a video clip at `atMs` for `lengthMs`: the clip is split there and
 * the held frame goes between the halves. Other lanes get the same room, so nothing
 * falls out of step (sound lanes simply have a gap while the picture holds).
 */
export function freezeFrame(p: Project, clipId: string, atMs: number, lengthMs: number): { project: Project; id: string | null } {
  const clip = p.clips.find((c) => c.id === clipId);
  if (!clip || clip.content.type !== "media" || !isEditable(p, clip) || atMs < clip.startMs || atMs >= clipEnd(clip)) return { project: p, id: null };
  const source = clip.freeze ? clip.sourceInMs : clip.sourceInMs + (atMs - clip.startMs) * clip.speed;
  const opened = insertTime(p, atMs, lengthMs);
  const id = newId("clp");
  const held: Clip = { ...clip, id, startMs: atMs, durationMs: lengthMs, sourceInMs: source, speed: 1, freeze: true, fadeInMs: 0, fadeOutMs: 0, linkGroup: undefined, transitionIn: undefined, transitionOut: undefined };
  return { project: { ...opened, clips: [...opened.clips, held] }, id };
}

/** The parts of a clip's look that "copy effects" carries from one clip to others. */
export function copyLook(p: Project, fromId: string, toIds: Iterable<string>): Project {
  const from = p.clips.find((c) => c.id === fromId);
  if (!from) return p;
  const targets = new Set(toIds);
  targets.delete(fromId);
  return {
    ...p,
    clips: p.clips.map((c) =>
      targets.has(c.id) && isEditable(p, c)
        ? { ...c, fx: from.fx, behavior: from.behavior, keyframes: from.keyframes, transitionIn: from.transitionIn, transitionOut: from.transitionOut, opacity: from.opacity, fadeInMs: Math.min(from.fadeInMs, c.durationMs), fadeOutMs: Math.min(from.fadeOutMs, c.durationMs) }
        : c,
    ),
  };
}
