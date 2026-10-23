/**
 * Teaching tools: step numbering, chapters and quizzes derived from the project.
 */
import type { Clip, Marker, Project } from "./project/schema";

/** Number shown on each step clip: its explicit number, else its order by start time. */
export function stepNumbers(project: Project): Map<string, number> {
  const steps = project.clips.filter((c) => c.content.type === "step").sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
  const out = new Map<string, number>();
  let n = 0;
  for (const c of steps) {
    n++;
    const explicit = c.content.type === "step" ? c.content.number : undefined;
    out.set(c.id, explicit ?? n);
  }
  return out;
}

export interface Chapter {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
}

/** Chapters from chapter markers (each runs until the next one or the end). */
export function chapters(project: Project, totalMs: number): Chapter[] {
  const ms = project.markers.filter((m) => m.kind === "chapter").sort((a, b) => a.timeMs - b.timeMs);
  return ms.map((m, i) => ({ id: m.id, title: m.label, startMs: m.timeMs, endMs: ms[i + 1]?.timeMs ?? totalMs }));
}

/** YouTube-style chapter list ("0:00 Title" lines); the first chapter must start at 0:00. */
export function chapterListText(list: Chapter[]): string {
  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(r).padStart(2, "0")}`;
  };
  return list.map((c) => `${fmt(c.startMs)} ${c.title}`).join("\n");
}

/** Quiz marker visible at time t (cards show for quiz.showMs after the marker). */
export function quizAt(project: Project, t: number): { marker: Marker; localMs: number } | undefined {
  for (const m of project.markers) {
    if (m.kind !== "quiz" || !m.quiz) continue;
    const local = t - m.timeMs;
    if (local >= 0 && local < m.quiz.showMs) return { marker: m, localMs: local };
  }
  return undefined;
}

/** Caption cues on caption lanes, in time order. */
export function captionClips(project: Project): Clip[] {
  const lanes = new Set(project.tracks.filter((t) => t.kind === "caption").map((t) => t.id));
  return project.clips.filter((c) => lanes.has(c.trackId) && c.content.type === "caption").sort((a, b) => a.startMs - b.startMs);
}
