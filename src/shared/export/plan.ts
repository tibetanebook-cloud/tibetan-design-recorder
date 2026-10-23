/**
 * What an export has to produce, decided from the project alone: the time
 * range, every output frame time, and the audio schedule (which piece of which
 * file plays when, how loud, how fast, with which lane effects).
 */
import { projectDurationMs } from "../project/factory";
import type { AudioFx, Project } from "../project/schema";
import { isAudible, isAudioTrack } from "../timeline/ops";
import type { ExportSettings } from "./settings";

export interface ExportRange {
  startMs: number;
  endMs: number;
}

export function exportRange(project: Project, s: Pick<ExportSettings, "range">, inMs: number | null, outMs: number | null): ExportRange {
  // Cursor tracks are metadata: they don't make the video longer.
  const visible = project.clips.filter((c) => project.tracks.find((t) => t.id === c.trackId)?.kind !== "cursor");
  const end = visible.length ? Math.max(...visible.map((c) => c.startMs + c.durationMs)) : projectDurationMs(project);
  if (s.range === "inout" && inMs !== null && outMs !== null && outMs > inMs) return { startMs: Math.max(0, inMs), endMs: Math.min(end, outMs) };
  return { startMs: 0, endMs: end };
}

/** Output frame times (timeline ms) at the given rate, from the start of the range. */
export function frameTimes(range: ExportRange, fps: number): number[] {
  const n = Math.max(1, Math.round(((range.endMs - range.startMs) / 1000) * fps));
  return Array.from({ length: n }, (_, i) => range.startMs + (i * 1000) / fps);
}

export interface AudioPiece {
  clipId: string;
  trackId: string;
  mediaId: string;
  /** Output time (ms, relative to the range start) where the piece begins. */
  atMs: number;
  /** Source position and length (ms of source audio). */
  sourceMs: number;
  sourceLenMs: number;
  /** Output length (ms) = source length / speed. */
  durationMs: number;
  speed: number;
  /** Clip volume × lane volume (fades are separate). */
  gain: number;
  /** Fades in output ms (already cut to the range). */
  fadeInMs: number;
  fadeOutMs: number;
  pan: number;
  fx?: AudioFx;
}

/** Audible clips of audio lanes inside the range, ready to schedule in an OfflineAudioContext. */
export function audioPlan(project: Project, range: ExportRange): AudioPiece[] {
  const pieces: AudioPiece[] = [];
  for (const clip of project.clips) {
    const track = project.tracks.find((t) => t.id === clip.trackId);
    if (!track || !isAudioTrack(track) || !clip.mediaId || !isAudible(project, clip)) continue;
    const media = project.media.find((m) => m.id === clip.mediaId);
    if (!media || media.kind !== "audio") continue;
    const start = Math.max(clip.startMs, range.startMs);
    const end = Math.min(clip.startMs + clip.durationMs, range.endMs);
    if (end <= start) continue;
    const cut = start - clip.startMs;
    pieces.push({
      clipId: clip.id,
      trackId: track.id,
      mediaId: media.id,
      atMs: start - range.startMs,
      sourceMs: clip.sourceInMs + cut * clip.speed,
      sourceLenMs: (end - start) * clip.speed,
      durationMs: end - start,
      speed: clip.speed,
      gain: clip.volume * track.volume,
      fadeInMs: Math.max(0, clip.fadeInMs - cut),
      fadeOutMs: Math.max(0, clip.fadeOutMs - (clip.startMs + clip.durationMs - end)),
      pan: track.pan,
      fx: track.audioFx,
    });
  }
  return pieces.sort((a, b) => a.atMs - b.atMs);
}

/**
 * Gain envelope of a piece as (time s, value) points for setValueCurveAtTime-free
 * scheduling with linear ramps; times relative to the piece start.
 */
export function fadeEnvelope(p: Pick<AudioPiece, "durationMs" | "fadeInMs" | "fadeOutMs" | "gain">): [number, number][] {
  const d = p.durationMs / 1000;
  const fi = Math.min(p.fadeInMs / 1000, d / 2), fo = Math.min(p.fadeOutMs / 1000, d / 2);
  const pts: [number, number][] = [[0, fi > 0 ? 0 : p.gain]];
  if (fi > 0) pts.push([fi, p.gain]);
  if (fo > 0) pts.push([d - fo, p.gain], [d, 0]);
  else pts.push([d, p.gain]);
  return pts;
}

/** Lanes that would be exported as separate files ("each track on its own"). */
export function exportableLanes(project: Project): { id: string; kind: string; audio: boolean }[] {
  return project.tracks
    .filter((t) => t.kind !== "cursor" && project.clips.some((c) => c.trackId === t.id))
    .map((t) => ({ id: t.id, kind: t.kind, audio: isAudioTrack(t) }));
}

/** The project reduced to one lane (others hidden and muted), for per-track export. The cursor lane stays, so a screen lane keeps its cursor. */
export function soloLane(project: Project, laneId: string): Project {
  return {
    ...project,
    tracks: project.tracks.map((t) =>
      t.id === laneId ? { ...t, hidden: false, muted: false, solo: false } : t.kind === "cursor" ? t : { ...t, hidden: true, muted: true, solo: false },
    ),
  };
}
