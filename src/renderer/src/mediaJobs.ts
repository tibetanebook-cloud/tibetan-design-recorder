/**
 * Jobs that read media: loudness analysis (for volume leveling) and speech-to-
 * text (auto-captions). Results are written into the project.
 */
import { estimateLufs } from "@shared/audio/fx";
import { wordsToCues, segmentsToWords, type Cue } from "@shared/captions/captions";
import { newId } from "@shared/project/factory";
import type { Clip, Project } from "@shared/project/schema";
import * as ops from "@shared/timeline/ops";
import { useJobs } from "./jobs";
import { useEditor } from "./store";

/** Longest file analysed in one piece (decoded audio is held in memory). */
const MAX_ANALYZE_MS = 30 * 60_000;

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Queue a loudness analysis for a media file (skipped if already known). */
export function analyzeMedia(mediaId: string, force = false): string | undefined {
  const project = useEditor.getState().history.present;
  const media = project.media.find((m) => m.id === mediaId);
  if (!media || media.kind !== "audio") return undefined;
  if (!force && project.analysis[mediaId]?.loudnessLufs !== undefined) return undefined;
  const running = useJobs.getState().jobs.find((j) => j.kind === "analyze" && j.detail === fileName(media.path) && (j.status === "queued" || j.status === "running"));
  if (running) return running.id;
  return useJobs.getState().enqueue(
    "analyze",
    "jobs.analyze",
    async (report, signal) => {
      if (media.durationMs > MAX_ANALYZE_MS) throw new Error("too-long");
      report(0.05);
      const data = await (await fetch(window.tdr.mediaUrl(media.path), { signal })).arrayBuffer();
      report(0.3);
      const ctx = new OfflineAudioContext(1, 1, 48000);
      const buf = await ctx.decodeAudioData(data);
      if (signal.aborted) return;
      report(0.7);
      // Mono mix.
      const mono = new Float32Array(buf.length);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const ch = buf.getChannelData(c);
        for (let i = 0; i < ch.length; i++) mono[i]! += ch[i]! / buf.numberOfChannels;
      }
      const { lufs, peakDb } = estimateLufs(mono, buf.sampleRate);
      useEditor.getState().annotate((p) => ({ ...p, analysis: { ...p.analysis, [mediaId]: { ...p.analysis[mediaId], loudnessLufs: lufs, peakDb } } }));
      return `${lufs.toFixed(1)} LUFS · peak ${peakDb.toFixed(1)} dB`;
    },
    fileName(media.path),
  );
}

/** Media of the audio clips on a lane (for "analyse this lane"). */
export function laneMediaIds(project: Project, trackId: string): string[] {
  return [...new Set(project.clips.filter((c) => c.trackId === trackId && c.mediaId).map((c) => c.mediaId!))];
}

/** Caption clips (on a caption lane, created if needed) from cues in timeline time. */
export function cuesToCaptionClips(project: Project, cues: Cue[], lang: string, replaceLane?: string): { project: Project; laneId: string; count: number } {
  let p = project;
  let laneId = replaceLane ?? p.tracks.find((t) => t.kind === "caption" && !t.locked)?.id;
  if (!laneId) {
    const r = ops.addTrack(p, "caption", 0);
    p = r.project;
    laneId = r.id;
  }
  const lane = laneId;
  const kept = p.clips.filter((c) => c.trackId !== lane);
  const clips: Clip[] = cues.map((cue, i) => {
    const next = cues[i + 1];
    const end = next ? Math.min(cue.endMs, next.startMs) : cue.endMs;
    return {
      id: newId("clp"),
      trackId: lane,
      content: { type: "caption", text: cue.text, lang },
      startMs: Math.max(0, cue.startMs),
      durationMs: Math.max(200, end - cue.startMs),
      sourceInMs: 0,
      speed: 1,
      opacity: 1,
      volume: 1,
      fadeInMs: 0,
      fadeOutMs: 0,
      muted: false,
      hidden: false,
      locked: false,
    };
  });
  return { project: { ...p, clips: [...kept, ...clips] }, laneId: lane, count: clips.length };
}

/** Caption cues of a lane, in timeline time. */
export function laneCues(project: Project, laneId: string): Cue[] {
  return project.clips
    .filter((c) => c.trackId === laneId && c.content.type === "caption" && !c.hidden)
    .sort((a, b) => a.startMs - b.startMs)
    .map((c) => ({ startMs: c.startMs, endMs: c.startMs + c.durationMs, text: c.content.type === "caption" ? c.content.text : "" }));
}

/**
 * Transcribe the clips of an audio lane and put the result on a caption lane.
 * Each clip is transcribed from its media file; times are mapped through the
 * clip's in-point and speed, and each word goes to the clip containing its middle.
 */
export function transcribeLane(trackId: string, language: string): string {
  const project = useEditor.getState().history.present;
  const clips = project.clips.filter((c) => c.trackId === trackId && c.mediaId && !c.muted).sort((a, b) => a.startMs - b.startMs);
  const track = project.tracks.find((t) => t.id === trackId);
  return useJobs.getState().enqueue(
    "transcribe",
    "jobs.transcribe",
    async (report, signal) => {
      const cues: Cue[] = [];
      let i = 0;
      const byMedia = new Map<string, Awaited<ReturnType<typeof window.tdr.transcribe.run>>>();
      for (const clip of clips) {
        if (signal.aborted) return;
        const media = useEditor.getState().history.present.media.find((m) => m.id === clip.mediaId);
        if (!media) continue;
        let res = byMedia.get(media.id);
        if (!res) {
          res = await window.tdr.transcribe.run({ path: media.path, language });
          if (!res.ok) throw new Error(res.error ?? "failed");
          byMedia.set(media.id, res);
        }
        const words = res.words.length ? res.words : segmentsToWords(res.segments);
        const inside = words
          // A word belongs to the clip that contains its middle (words across a cut are kept once).
          .filter((w) => (w.startMs + w.endMs) / 2 >= clip.sourceInMs && (w.startMs + w.endMs) / 2 < clip.sourceInMs + clip.durationMs * clip.speed)
          .map((w) => ({ ...w, startMs: clip.startMs + (w.startMs - clip.sourceInMs) / clip.speed, endMs: clip.startMs + (w.endMs - clip.sourceInMs) / clip.speed }));
        const style = useEditor.getState().history.present.captionStyle;
        cues.push(...wordsToCues(inside, Math.round((42 * style.maxWidthPct) / 70), style.rows));
        report(++i / clips.length);
      }
      if (signal.aborted) return;
      const lang = language || (/[ༀ-࿿]/.test(cues.map((c) => c.text).join("")) ? "bo" : "en");
      let count = 0;
      useEditor.getState().edit("audio.captions", (p) => {
        const r = cuesToCaptionClips(p, cues, lang);
        count = r.count;
        return r.project;
      });
      return `${count} · ${track?.name || track?.kind || ""}`;
    },
    track?.name || track?.kind,
  );
}
