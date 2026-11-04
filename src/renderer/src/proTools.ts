/**
 * Editor commands that need more than a pure edit: reading a recording's loudness,
 * recording narration from the microphone, saving a frame, packaging a project.
 */
import { DEFAULT_SILENCE, duckingPoints, findSilences, mergeRanges, sourceRangesToTimeline, type TimeRange } from "@shared/audio/silence";
import type { Clip, Project } from "@shared/project/schema";
import { serializeProject } from "@shared/project/schema";
import * as ops from "@shared/timeline/ops";
import { deleteRanges } from "@shared/timeline/ranges";
import { importMedia } from "./actions";
import { FrameRenderer } from "./export/exporter";
import { useEditor } from "./store";
import { PEAKS_PER_SECOND, waveformPeaks } from "./timeline/waveform";

const notice = (key: string, extra = "") => {
  const s = useEditor.getState();
  s.setNotice(`${s.t(key)}${extra}`);
};

/** The clips of the voice lane: the selected audio lane, else the microphone lane. */
function voiceClips(p: Project): Clip[] {
  const s = useEditor.getState();
  const selected = p.tracks.find((t) => t.id === (p.clips.find((c) => c.id === s.selection[0])?.trackId ?? s.selectedTrackId));
  const lane = selected && ops.isAudioTrack(selected) ? selected : p.tracks.find((t) => t.kind === "mic" && p.clips.some((c) => c.trackId === t.id));
  return lane ? p.clips.filter((c) => c.trackId === lane.id && c.mediaId).sort((a, b) => a.startMs - b.startMs) : [];
}

async function clipSilences(p: Project, clip: Clip, minMs: number, keepMs: number): Promise<TimeRange[]> {
  const media = p.media.find((m) => m.id === clip.mediaId);
  if (!media) return [];
  const peaks = await waveformPeaks(media.path, media.durationMs);
  if (!peaks) return [];
  return sourceRangesToTimeline(clip, findSilences(peaks, { ...DEFAULT_SILENCE, rate: PEAKS_PER_SECOND, minMs, keepMs }));
}

/** Cut the long pauses of the voice lane out of the whole video (one undo step). */
export async function removeSilences(): Promise<number> {
  const s = useEditor.getState();
  const p = s.history.present;
  const clips = voiceClips(p);
  if (!clips.length) {
    notice("notice.noVoice");
    return 0;
  }
  const ranges = mergeRanges((await Promise.all(clips.map((c) => clipSilences(p, c, DEFAULT_SILENCE.minMs, DEFAULT_SILENCE.keepMs)))).flat());
  if (!ranges.length) {
    notice("notice.noSilences");
    return 0;
  }
  s.edit("audio.removeSilence", (q) => deleteRanges(q, ranges));
  notice("notice.silencesRemoved", `: ${ranges.length}`);
  return ranges.length;
}

/** Fill the music's volume points so it drops while the voice lane is speaking. */
export async function duckMusic(lowered = 0.25): Promise<number> {
  const s = useEditor.getState();
  const p = s.history.present;
  const isMusic = (c: Clip) => p.tracks.find((t) => t.id === c.trackId)?.kind === "audio" && !!c.mediaId;
  const picked = p.clips.filter((c) => s.selection.includes(c.id) && isMusic(c));
  const music = picked.length ? picked : p.clips.filter(isMusic);
  if (!music.length) {
    notice("notice.noMusic");
    return 0;
  }
  const voice = p.clips.filter((c) => p.tracks.find((t) => t.id === c.trackId)?.kind === "mic" && c.mediaId).sort((a, b) => a.startMs - b.startMs);
  if (!voice.length) {
    notice("notice.noVoice");
    return 0;
  }
  // Quiet = the voice's pauses plus everywhere it has no clip.
  const quiet: TimeRange[] = (await Promise.all(voice.map((c) => clipSilences(p, c, 500, 0)))).flat();
  let cursor = 0;
  for (const c of voice) {
    if (c.startMs > cursor) quiet.push({ startMs: cursor, endMs: c.startMs });
    cursor = Math.max(cursor, c.startMs + c.durationMs);
  }
  quiet.push({ startMs: cursor, endMs: Number.MAX_SAFE_INTEGER });
  const ids = new Set(music.map((c) => c.id));
  s.edit("audio.duckMusic", (q) => ({ ...q, clips: q.clips.map((c) => (ids.has(c.id) ? { ...c, volumePoints: duckingPoints(c, quiet, lowered) } : c)) }));
  notice("notice.musicLowered");
  return music.length;
}

// ---------------------------------------------------------------- narration

let narration: { recorder: MediaRecorder; stream: MediaStream; startMs: number; chunks: Blob[] } | null = null;

/** First call: play from the playhead and record the microphone. Second call: stop and add the recording. */
export async function toggleNarration(): Promise<void> {
  const s = useEditor.getState();
  if (narration) {
    const { recorder, stream, startMs, chunks } = narration;
    narration = null;
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    stream.getTracks().forEach((t) => t.stop());
    s.setPlaying(false);
    s.setNotice(null);
    const data = new Uint8Array(await new Blob(chunks, { type: "audio/webm" }).arrayBuffer());
    const path = await window.tdr.saveNarration(data);
    const back = useEditor.getState().playheadMs;
    useEditor.getState().setPlayhead(startMs);
    await importMedia([path]);
    useEditor.getState().setPlayhead(back);
    return;
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch {
    notice("notice.narrationFailed");
    return;
  }
  const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 160_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  narration = { recorder, stream, startMs: s.playheadMs, chunks };
  recorder.start(1000);
  s.setPlaying(true);
  s.setNotice(s.t("notice.narrating"), true);
}

export const isNarrating = () => narration !== null;

// ---------------------------------------------------------------- files

/** Save the frame at the playhead as a PNG at full project size. */
export async function saveFrame(): Promise<string | null> {
  const s = useEditor.getState();
  const p = s.history.present;
  const renderer = new FrameRenderer(p, p.canvas.width, p.canvas.height);
  try {
    await renderer.init();
    const canvas = await renderer.render(s.playheadMs);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return null;
    const path = await window.tdr.saveBinary(`${p.name || "frame"}.png`, ["png"], new Uint8Array(await blob.arrayBuffer()));
    if (path) notice("notice.frameSaved");
    return path;
  } finally {
    renderer.dispose();
  }
}

/** Copy the project and every file it uses into one folder, so it can be moved or shared. */
export async function packageProject(): Promise<string | null> {
  const s = useEditor.getState();
  const path = await window.tdr.packageProject(serializeProject(s.history.present));
  if (path) notice("notice.packaged");
  return path;
}
