/**
 * Timeline editing operations. Every function is pure (Project in, Project out)
 * so each edit is one undoable history step and can be unit-tested.
 *
 * Rules shared by all operations:
 *  - Clips on the same lane never overlap.
 *  - Locked clips and clips on locked lanes are never changed.
 *  - Linked clips (same linkGroup) move, trim, split and delete together; linking
 *    is optional and can be undone at any time.
 *  - A media clip can never reach outside its source file.
 */
import { newId } from "../project/factory";
import type { Clip, Marker, Project, Track, TrackKind } from "../project/schema";

/** Shortest clip the editor allows (≈ one frame at 60 fps). */
export const MIN_CLIP_MS = 16;
export const MIN_SPEED = 0.1;
export const MAX_SPEED = 16;

// ---------- queries ----------

export const clipEnd = (c: Clip): number => c.startMs + c.durationMs;
export const trackById = (p: Project, id: string): Track | undefined => p.tracks.find((t) => t.id === id);
export const clipById = (p: Project, id: string): Clip | undefined => p.clips.find((c) => c.id === id);

export function isEditable(p: Project, clip: Clip): boolean {
  return !clip.locked && !trackById(p, clip.trackId)?.locked;
}

/** Ids plus every clip linked to them. */
export function withLinked(p: Project, ids: Iterable<string>): Set<string> {
  const out = new Set(ids);
  const groups = new Set(p.clips.filter((c) => out.has(c.id) && c.linkGroup).map((c) => c.linkGroup!));
  for (const c of p.clips) if (c.linkGroup && groups.has(c.linkGroup)) out.add(c.id);
  return out;
}

/** Longest timeline length a clip may have from its current in-point (Infinity for generated content). */
export function maxDurationMs(p: Project, clip: Clip): number {
  if (clip.content.type !== "media" || !clip.mediaId) return Infinity;
  const media = p.media.find((m) => m.id === clip.mediaId);
  if (!media || media.kind === "image") return Infinity;
  return Math.max(0, (media.durationMs - clip.sourceInMs) / clip.speed);
}

const VIDEO_KINDS: TrackKind[] = ["screen", "webcam", "video"];
const AUDIO_KINDS: TrackKind[] = ["mic", "system", "audio"];

/** Can this clip live on that lane? Media type must match the lane family. */
export function canPlaceOn(p: Project, clip: Clip, track: Track): boolean {
  if (clip.content.type === "text") return track.kind === "annotation" || track.kind === "caption";
  if (clip.content.type === "caption") return track.kind === "caption";
  if (["shape", "callout", "highlight", "spotlight", "redact", "step", "title"].includes(clip.content.type)) return track.kind === "annotation";
  if (clip.content.type === "solid") return track.kind === "annotation" || VIDEO_KINDS.includes(track.kind) || track.kind === "image";
  const media = p.media.find((m) => m.id === clip.mediaId);
  if (!media) return false;
  if (media.kind === "video") return VIDEO_KINDS.includes(track.kind);
  if (media.kind === "audio") return AUDIO_KINDS.includes(track.kind);
  if (media.kind === "image") return track.kind === "image" || track.kind === "video" || track.kind === "annotation";
  if (media.kind === "cursor") return track.kind === "cursor";
  return false;
}

export const isAudioTrack = (t: Track): boolean => AUDIO_KINDS.includes(t.kind);
export const isVisualTrack = (t: Track): boolean => !AUDIO_KINDS.includes(t.kind);

/**
 * Whether a clip is heard. Solo works per family: if any audio-carrying lane is
 * soloed, only soloed lanes play. Video lanes carry no sound in this app (each
 * input's audio is its own lane), so this applies to audio lanes.
 */
export function isAudible(p: Project, clip: Clip): boolean {
  const track = trackById(p, clip.trackId);
  if (!track || track.muted || clip.muted || !isAudioTrack(track)) return false;
  const anySolo = p.tracks.some((t) => t.solo && isAudioTrack(t));
  return !anySolo || track.solo;
}

/** Free gap on a lane around a time, ignoring some clips. */
function neighbours(p: Project, trackId: string, ignore: Set<string>, startMs: number, endMs: number) {
  let prevEnd = 0;
  let nextStart = Infinity;
  for (const c of p.clips) {
    if (c.trackId !== trackId || ignore.has(c.id)) continue;
    if (clipEnd(c) <= startMs + 0.001) prevEnd = Math.max(prevEnd, clipEnd(c));
    else if (c.startMs >= endMs - 0.001) nextStart = Math.min(nextStart, c.startMs);
  }
  return { prevEnd, nextStart };
}

function overlaps(p: Project, trackId: string, ignore: Set<string>, startMs: number, endMs: number): boolean {
  return p.clips.some((c) => c.trackId === trackId && !ignore.has(c.id) && c.startMs < endMs - 0.001 && clipEnd(c) > startMs + 0.001);
}

const replaceClips = (p: Project, changed: Map<string, Clip>): Project =>
  changed.size ? { ...p, clips: p.clips.map((c) => changed.get(c.id) ?? c) } : p;

// ---------- move ----------

/**
 * Move clips (and their linked clips) by deltaMs, optionally `laneDelta` lanes
 * down (+) or up (−). The move is clamped so clips stop at neighbours instead of
 * overlapping them; a lane change only happens if every moved clip fits there.
 */
export function moveClips(p: Project, ids: Iterable<string>, deltaMs: number, laneDelta = 0): Project {
  const moving = [...withLinked(p, ids)].map((id) => clipById(p, id)!).filter((c) => c && isEditable(p, c));
  if (!moving.length) return p;
  const movingIds = new Set(moving.map((c) => c.id));

  // Lane change (only the explicitly chosen clips change lanes; linked partners stay on theirs).
  const direct = new Set(ids);
  const laneOf = new Map<string, string>();
  if (laneDelta) {
    for (const c of moving) {
      if (!direct.has(c.id)) continue;
      const index = p.tracks.findIndex((t) => t.id === c.trackId);
      const target = p.tracks[index + laneDelta];
      if (!target || target.locked || !canPlaceOn(p, c, target)) return moveClips(p, ids, deltaMs, 0);
      laneOf.set(c.id, target.id);
    }
  }

  // Clamp the time delta so nobody goes below 0 or into a neighbour.
  let delta = deltaMs;
  for (const c of moving) {
    const lane = laneOf.get(c.id) ?? c.trackId;
    delta = Math.max(delta, -c.startMs);
    if (lane === c.trackId) {
      const { prevEnd, nextStart } = neighbours(p, lane, movingIds, c.startMs, clipEnd(c));
      delta = Math.max(delta, prevEnd - c.startMs);
      delta = Math.min(delta, nextStart - clipEnd(c));
    }
  }
  // On a new lane the destination must be free at the final position.
  for (const c of moving) {
    const lane = laneOf.get(c.id);
    if (lane && overlaps(p, lane, movingIds, c.startMs + delta, clipEnd(c) + delta)) return moveClips(p, ids, deltaMs, 0);
  }
  if (Math.abs(delta) < 0.001 && !laneOf.size) return p;
  const changed = new Map(moving.map((c) => [c.id, { ...c, startMs: c.startMs + delta, trackId: laneOf.get(c.id) ?? c.trackId }]));
  return replaceClips(p, changed);
}

// ---------- trim ----------

/**
 * Drag a clip edge to `timeMs`. The linked clips' same edge moves by the same
 * amount. Limits: neighbours, the start of the timeline, the source file, and
 * MIN_CLIP_MS.
 */
export function trimClip(p: Project, id: string, edge: "start" | "end", timeMs: number): Project {
  const clip = clipById(p, id);
  if (!clip || !isEditable(p, clip)) return p;
  const group = [...withLinked(p, [id])].map((x) => clipById(p, x)!).filter((c) => isEditable(p, c));
  const groupIds = new Set(group.map((c) => c.id));
  let delta = timeMs - (edge === "start" ? clip.startMs : clipEnd(clip));
  for (const c of group) {
    const { prevEnd, nextStart } = neighbours(p, c.trackId, groupIds, c.startMs, clipEnd(c));
    if (edge === "start") {
      delta = Math.max(delta, prevEnd - c.startMs, -c.sourceInMs / c.speed); // not before the neighbour or source start
      delta = Math.min(delta, c.durationMs - MIN_CLIP_MS);
    } else {
      delta = Math.min(delta, nextStart - clipEnd(c), maxDurationMs(p, c) - c.durationMs);
      delta = Math.max(delta, MIN_CLIP_MS - c.durationMs);
    }
  }
  if (Math.abs(delta) < 0.001) return p;
  const changed = new Map<string, Clip>();
  for (const c of group) {
    changed.set(
      c.id,
      edge === "start"
        ? { ...c, startMs: c.startMs + delta, durationMs: c.durationMs - delta, sourceInMs: c.sourceInMs + delta * c.speed }
        : { ...c, durationMs: c.durationMs + delta },
    );
  }
  return replaceClips(p, changed);
}

// ---------- split ----------

/**
 * Split at timeMs. If ids are given, those clips (and linked ones) are split;
 * otherwise every editable clip under the playhead. Linked right-hand halves get
 * a new link group so the two halves are independent of each other.
 */
export function splitAt(p: Project, timeMs: number, ids?: Iterable<string>): Project {
  const pool = ids ? withLinked(p, ids) : new Set(p.clips.map((c) => c.id));
  const targets = p.clips.filter(
    (c) => pool.has(c.id) && isEditable(p, c) && c.startMs + MIN_CLIP_MS <= timeMs && clipEnd(c) - MIN_CLIP_MS >= timeMs,
  );
  if (!targets.length) return p;
  const groupMap = new Map<string, string>();
  const clips: Clip[] = [];
  for (const c of p.clips) {
    if (!targets.includes(c)) {
      clips.push(c);
      continue;
    }
    const left = timeMs - c.startMs;
    let group = c.linkGroup;
    if (group) {
      if (!groupMap.has(group)) groupMap.set(group, newId("lnk"));
      group = groupMap.get(group);
    }
    clips.push({ ...c, durationMs: left, fadeOutMs: 0 });
    clips.push({
      ...c,
      id: newId("clp"),
      startMs: timeMs,
      durationMs: c.durationMs - left,
      sourceInMs: c.sourceInMs + left * c.speed,
      fadeInMs: 0,
      linkGroup: group,
    });
  }
  return { ...p, clips };
}

// ---------- delete / ripple ----------

export function deleteClips(p: Project, ids: Iterable<string>): Project {
  const doomed = new Set([...withLinked(p, ids)].filter((id) => isEditable(p, clipById(p, id)!)));
  if (!doomed.size) return p;
  return { ...p, clips: p.clips.filter((c) => !doomed.has(c.id)) };
}

/**
 * Delete and close the gap: on each lane that lost a clip, later clips slide left
 * by the deleted length. Locked lanes are not shifted.
 */
export function rippleDelete(p: Project, ids: Iterable<string>): Project {
  const doomed = p.clips.filter((c) => withLinked(p, ids).has(c.id) && isEditable(p, c));
  if (!doomed.length) return p;
  const doomedIds = new Set(doomed.map((c) => c.id));
  const clips = p.clips
    .filter((c) => !doomedIds.has(c.id))
    .map((c) => {
      const removedBefore = doomed
        .filter((d) => d.trackId === c.trackId && clipEnd(d) <= c.startMs + 0.001)
        .reduce((sum, d) => sum + d.durationMs, 0);
      return removedBefore && isEditable(p, c) ? { ...c, startMs: Math.max(0, c.startMs - removedBefore) } : c;
    });
  return { ...p, clips };
}

// ---------- duplicate / paste ----------

/** First free start on a lane at or after `fromMs` for a clip of this length. */
export function firstFreeStart(p: Project, trackId: string, fromMs: number, durationMs: number, ignore = new Set<string>()): number {
  let start = Math.max(0, fromMs);
  const lane = p.clips.filter((c) => c.trackId === trackId && !ignore.has(c.id)).sort((a, b) => a.startMs - b.startMs);
  for (const c of lane) {
    if (c.startMs < start + durationMs - 0.001 && clipEnd(c) > start + 0.001) start = clipEnd(c);
  }
  return start;
}

/** Place copies of clips (keeping their relative timing) starting at `atMs`, each on its lane's next free spot. */
export function pasteClips(p: Project, clips: Clip[], atMs: number): { project: Project; ids: string[] } {
  if (!clips.length) return { project: p, ids: [] };
  const first = Math.min(...clips.map((c) => c.startMs));
  const groupMap = new Map<string, string>();
  let next = p;
  const ids: string[] = [];
  for (const c of [...clips].sort((a, b) => a.startMs - b.startMs)) {
    const track = trackById(next, c.trackId);
    if (!track || track.locked) continue;
    const id = newId("clp");
    let group = c.linkGroup;
    if (group) {
      if (!groupMap.has(group)) groupMap.set(group, newId("lnk"));
      group = groupMap.get(group);
    }
    const start = firstFreeStart(next, c.trackId, atMs + (c.startMs - first), c.durationMs);
    next = { ...next, clips: [...next.clips, { ...c, id, startMs: start, linkGroup: group, locked: false }] };
    ids.push(id);
  }
  return { project: next, ids };
}

/** Copies go right after the originals on the same lanes. */
export function duplicateClips(p: Project, ids: Iterable<string>): { project: Project; ids: string[] } {
  const source = [...withLinked(p, ids)].map((id) => clipById(p, id)!).filter(Boolean);
  if (!source.length) return { project: p, ids: [] };
  const end = Math.max(...source.map(clipEnd));
  return pasteClips(p, source, end);
}

// ---------- link ----------

export function linkClips(p: Project, ids: Iterable<string>): Project {
  const set = [...ids].filter((id) => clipById(p, id));
  if (set.length < 2) return p;
  const group = newId("lnk");
  const all = withLinked(p, set);
  return { ...p, clips: p.clips.map((c) => (all.has(c.id) ? { ...c, linkGroup: group } : c)) };
}

export function unlinkClips(p: Project, ids: Iterable<string>): Project {
  const all = withLinked(p, ids);
  if (!p.clips.some((c) => all.has(c.id) && c.linkGroup)) return p;
  return { ...p, clips: p.clips.map((c) => (all.has(c.id) ? { ...c, linkGroup: undefined } : c)) };
}

// ---------- properties ----------

export type ClipPatch = Partial<
  Pick<Clip, "opacity" | "volume" | "fadeInMs" | "fadeOutMs" | "muted" | "hidden" | "locked" | "frame" | "crop" | "content">
> & { speed?: number };

/**
 * Change clip properties. Speed keeps the in-point and the source span, so the
 * clip gets shorter/longer on the timeline (and stops at the next clip).
 */
export function setClipProps(p: Project, ids: Iterable<string>, patch: ClipPatch): Project {
  const set = new Set(ids);
  const changed = new Map<string, Clip>();
  for (const c of p.clips) {
    if (!set.has(c.id)) continue;
    // "locked" itself can always be toggled; everything else needs an editable clip.
    if (!isEditable(p, c) && !(Object.keys(patch).length === 1 && "locked" in patch)) continue;
    const next: Clip = { ...c, ...patch, speed: c.speed };
    if (patch.speed !== undefined && patch.speed !== c.speed) {
      const speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, patch.speed));
      const span = c.durationMs * c.speed;
      const { nextStart } = neighbours(p, c.trackId, new Set([c.id]), c.startMs, clipEnd(c));
      next.speed = speed;
      next.durationMs = Math.max(MIN_CLIP_MS, Math.min(span / speed, nextStart - c.startMs));
    }
    next.fadeInMs = Math.max(0, Math.min(next.fadeInMs, next.durationMs));
    next.fadeOutMs = Math.max(0, Math.min(next.fadeOutMs, next.durationMs - next.fadeInMs));
    changed.set(c.id, next);
  }
  return replaceClips(p, changed);
}

export type TrackPatch = Partial<Pick<Track, "name" | "locked" | "muted" | "solo" | "hidden" | "volume" | "pan" | "opacity" | "audioFx">>;

export function setTrackProps(p: Project, trackId: string, patch: TrackPatch): Project {
  if (!trackById(p, trackId)) return p;
  return { ...p, tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)) };
}

// ---------- lanes ----------

export function addTrack(p: Project, kind: TrackKind, index = 0): { project: Project; id: string } {
  const track: Track = { id: newId("trk"), kind, name: "", locked: false, muted: false, solo: false, hidden: false, volume: 1, pan: 0, opacity: 1 };
  const tracks = [...p.tracks];
  tracks.splice(Math.max(0, Math.min(index, tracks.length)), 0, track);
  return { project: { ...p, tracks }, id: track.id };
}

/** Remove a lane and its clips. The four recording lanes stay (they can be hidden instead). */
export function removeTrack(p: Project, trackId: string): Project {
  const track = trackById(p, trackId);
  if (!track || track.locked || ["screen", "webcam", "mic", "system"].includes(track.kind)) return p;
  return { ...p, tracks: p.tracks.filter((t) => t.id !== trackId), clips: p.clips.filter((c) => c.trackId !== trackId) };
}

export function moveTrack(p: Project, trackId: string, toIndex: number): Project {
  const from = p.tracks.findIndex((t) => t.id === trackId);
  if (from < 0) return p;
  const tracks = [...p.tracks];
  const [t] = tracks.splice(from, 1);
  tracks.splice(Math.max(0, Math.min(toIndex, tracks.length)), 0, t!);
  return { ...p, tracks };
}

// ---------- markers ----------

export function addMarker(p: Project, timeMs: number, kind: Marker["kind"] = "marker", label = ""): { project: Project; id: string } {
  const marker: Marker = { id: newId("mrk"), timeMs: Math.max(0, timeMs), label, kind };
  return { project: { ...p, markers: [...p.markers, marker].sort((a, b) => a.timeMs - b.timeMs) }, id: marker.id };
}

export function updateMarker(p: Project, id: string, patch: Partial<Omit<Marker, "id">>): Project {
  return { ...p, markers: p.markers.map((m) => (m.id === id ? { ...m, ...patch, timeMs: Math.max(0, patch.timeMs ?? m.timeMs) } : m)).sort((a, b) => a.timeMs - b.timeMs) };
}

export function removeMarker(p: Project, id: string): Project {
  return { ...p, markers: p.markers.filter((m) => m.id !== id) };
}

// ---------- snapping ----------

/** Times worth snapping to: 0, every clip edge, markers, the playhead. */
export function snapPoints(p: Project, exclude: Set<string>, playheadMs?: number): number[] {
  const points = new Set<number>([0]);
  for (const c of p.clips) {
    if (exclude.has(c.id)) continue;
    points.add(c.startMs);
    points.add(clipEnd(c));
  }
  for (const m of p.markers) points.add(m.timeMs);
  if (playheadMs !== undefined) points.add(playheadMs);
  return [...points];
}

/** Snap `timeMs` to the nearest point within `thresholdMs`; returns the point used. */
export function snap(timeMs: number, points: number[], thresholdMs: number): { timeMs: number; snappedTo?: number } {
  let best: number | undefined;
  for (const pt of points) if (Math.abs(pt - timeMs) <= thresholdMs && (best === undefined || Math.abs(pt - timeMs) < Math.abs(best - timeMs))) best = pt;
  return best === undefined ? { timeMs } : { timeMs: best, snappedTo: best };
}

/**
 * Snap a moving block (several clips) by whichever of its edges lands closest
 * to a snap point; returns the adjusted delta.
 */
export function snapDelta(edges: number[], deltaMs: number, points: number[], thresholdMs: number): { deltaMs: number; snappedTo?: number } {
  let best: { deltaMs: number; snappedTo: number; distance: number } | undefined;
  for (const edge of edges) {
    const moved = edge + deltaMs;
    for (const pt of points) {
      const d = Math.abs(pt - moved);
      if (d <= thresholdMs && (!best || d < best.distance)) best = { deltaMs: deltaMs + (pt - moved), snappedTo: pt, distance: d };
    }
  }
  return best ? { deltaMs: best.deltaMs, snappedTo: best.snappedTo } : { deltaMs };
}
